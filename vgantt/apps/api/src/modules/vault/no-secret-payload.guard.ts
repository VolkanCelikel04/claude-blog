import { BadRequestException, CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Request } from 'express';

/**
 * Runtime enforcement of the module C boundary.
 *
 * The vault's contract is that credentials never leave the user's machine. The
 * DTOs below already have no field to put one in - but a DTO is a promise a
 * future commit can break. This guard inspects the actual request body and
 * refuses anything credential-shaped, so the endpoint cannot start accepting
 * secrets by accident.
 *
 * It is intentionally noisy: a hit here means client code tried to upload
 * something it must not, and that is worth an alert, not a silent strip.
 */
const FORBIDDEN_KEY = new RegExp(
  '(^|_)(password|passwd|pwd|secret|credential|credentials|passphrase|apikey|' +
    'api_key|private_key|access_key|client_secret|otp|totp|mfa_secret|salt|' +
    'iv|ciphertext|plaintext|entries|entry|vault_data)($|_)',
  'i',
);

@Injectable()
export class NoSecretPayloadGuard implements CanActivate {
  private readonly logger = new Logger(NoSecretPayloadGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const offenders = this.scan(request.body);

    if (offenders.length > 0) {
      this.logger.error(
        `VAULT BOUNDARY VIOLATION on ${request.method} ${request.url}: ` +
          `payload contained ${offenders.join(', ')}`,
      );
      throw new BadRequestException({
        error: 'VAULT_BOUNDARY_VIOLATION',
        fields: offenders,
        message:
          'Şifre kasası verileri sunucuya gönderilemez. Bu modüldeki tüm veriler ' +
          'yalnızca yerel makinede (C:/Rsdw) saklanır.',
      });
    }

    return true;
  }

  private scan(value: unknown, path = '', depth = 0): string[] {
    if (depth > 6 || value === null || typeof value !== 'object') return [];

    const found: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEY.test(key)) {
        found.push(fullPath);
        continue;
      }
      found.push(...this.scan(child, fullPath, depth + 1));
    }
    return found;
  }
}
