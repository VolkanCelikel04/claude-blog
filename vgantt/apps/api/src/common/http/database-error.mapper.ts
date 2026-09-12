import { ConflictException, ForbiddenException, HttpException, BadRequestException } from '@nestjs/common';

interface PgError extends Error {
  code?: string;
  constraint?: string;
  detail?: string;
  table?: string;
}

/**
 * Turns PostgreSQL error codes into HTTP responses the frontend can act on.
 *
 * Note 42501 (insufficient_privilege): that is row level security or the
 * cross-tenant trigger refusing the operation. It means a request got past the
 * application guards and was stopped by the database - worth logging loudly.
 */
export function mapDatabaseError(error: unknown): HttpException | undefined {
  const pg = error as PgError;
  if (!pg?.code) return undefined;

  switch (pg.code) {
    case '23505': // unique_violation
      return new ConflictException({
        error: 'DUPLICATE',
        constraint: pg.constraint,
        message: friendlyUniqueMessage(pg.constraint),
      });

    case '23503': // foreign_key_violation
      return new ConflictException({
        error: 'REFERENCE_IN_USE',
        message: 'Bu kayıt başka kayıtlar tarafından kullanıldığı için işlem yapılamadı.',
      });

    case '23514': // check_violation
      return new BadRequestException({
        error: 'CHECK_FAILED',
        constraint: pg.constraint,
        message: 'Girilen değerler kuralları karşılamıyor.',
      });

    case '23502': // not_null_violation
      return new BadRequestException({
        error: 'REQUIRED_FIELD',
        message: 'Zorunlu bir alan boş bırakıldı.',
      });

    case '42501': // insufficient_privilege - RLS or the tenant trigger
      return new ForbiddenException({
        error: 'ISOLATION_VIOLATION',
        message: 'Bu veriye erişim yetkiniz yok.',
      });

    case '23P01': // exclusion_violation
      return new ConflictException({
        error: 'OVERLAPPING_PERIOD',
        message: 'Bu tarih aralığı mevcut bir kayıtla çakışıyor.',
      });

    default:
      return undefined;
  }
}

function friendlyUniqueMessage(constraint?: string): string {
  switch (constraint) {
    case 'users_email_unique_per_tenant':
      return 'Bu e-posta adresi şirketinizde zaten kayıtlı.';
    case 'customer_invoices_no_unique':
      return 'Bu fatura numarası daha önce kullanılmış.';
    case 'licenses_unique_per_tenant':
      return 'Aynı isim, tür ve bitiş tarihine sahip bir lisans kaydı zaten var.';
    case 'tenants_slug_key':
      return 'Bu şirket kodu başka bir şirket tarafından kullanılıyor.';
    default:
      return 'Bu kayıt zaten mevcut.';
  }
}
