import { Injectable, Logger } from '@nestjs/common';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { compare as bcryptCompare } from 'bcryptjs';

/**
 * Argon2id for everything we write.
 *
 * bcrypt verification is kept because the seed data is hashed by PostgreSQL's
 * pgcrypto crypt(). Any bcrypt password that authenticates successfully is
 * transparently upgraded to argon2id, so the legacy format drains away on its
 * own instead of lingering forever.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);

  private readonly options = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19_456, // 19 MiB - OWASP baseline
    timeCost: 2,
    parallelism: 1,
  };

  async hash(plain: string): Promise<string> {
    return argonHash(plain, this.options);
  }

  async verify(stored: string, plain: string): Promise<boolean> {
    try {
      if (stored.startsWith('$argon2')) {
        return await argonVerify(stored, plain, this.options);
      }
      if (/^\$2[aby]?\$/.test(stored)) {
        return await bcryptCompare(plain, stored);
      }
      this.logger.warn('Unrecognised password hash format; rejecting');
      return false;
    } catch (error) {
      this.logger.warn(`Password verification error: ${(error as Error).message}`);
      return false;
    }
  }

  /** True when the stored hash should be rewritten after a successful login. */
  needsRehash(stored: string): boolean {
    return !stored.startsWith('$argon2id');
  }

  /**
   * Deliberately simple: length plus a character-class mix. Complexity theatre
   * (forced symbols, 90-day rotation) is not what keeps accounts safe.
   */
  validateStrength(plain: string, minLength: number): string[] {
    const problems: string[] = [];
    if (plain.length < minLength) {
      problems.push(`Şifre en az ${minLength} karakter olmalıdır.`);
    }
    if (!/[a-zçğıöşü]/.test(plain) || !/[A-ZÇĞİÖŞÜ]/.test(plain)) {
      problems.push('Şifre hem küçük hem büyük harf içermelidir.');
    }
    if (!/[0-9]/.test(plain)) {
      problems.push('Şifre en az bir rakam içermelidir.');
    }
    return problems;
  }
}
