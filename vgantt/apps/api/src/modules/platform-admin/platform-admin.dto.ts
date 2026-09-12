import {
  IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'cancelled'] as const;
export const SUBSCRIPTION_STATUSES =
  ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'expired'] as const;

export class CreateTenantDto {
  @IsString() @MinLength(3) @MaxLength(50)
  @Matches(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, {
    message: 'Şirket kodu yalnızca küçük harf, rakam ve tire içerebilir.',
  })
  slug!: string;

  @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(250)
  legalName?: string;

  @IsOptional() @IsString() @MaxLength(100)
  taxOffice?: string;

  @IsOptional() @IsString() @MaxLength(40)
  taxNumber?: string;

  // --- primary contact ------------------------------------------------------
  @IsString() @MinLength(2) @MaxLength(150)
  contactName!: string;

  @IsEmail()
  contactEmail!: string;

  @IsOptional() @IsString() @MaxLength(40)
  contactPhone?: string;

  // --- initial subscription -------------------------------------------------
  @IsUUID()
  planId!: string;

  @IsDateString()
  endsOn!: string;

  @IsOptional() @IsInt() @Min(1) @Max(10_000)
  seats?: number;

  /** Modules to switch on at creation. Defaults to the plan's bundle. */
  @IsOptional() @IsArray() @IsString({ each: true })
  modules?: string[];

  // --- first admin user -----------------------------------------------------
  @IsEmail()
  adminEmail!: string;

  @IsString() @MinLength(2) @MaxLength(150)
  adminFullName!: string;

  @IsString() @MinLength(10) @MaxLength(256)
  adminPassword!: string;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(250) legalName?: string;
  @IsOptional() @IsString() @MaxLength(100) taxOffice?: string;
  @IsOptional() @IsString() @MaxLength(40)  taxNumber?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsEnum(TENANT_STATUSES) status?: (typeof TENANT_STATUSES)[number];
}

export class ToggleModuleDto {
  @IsBoolean()
  enabled!: boolean;

  /** Optional module-specific expiry, independent of the subscription. */
  @IsOptional() @IsDateString()
  validUntil?: string;

  @IsOptional() @IsInt() @Min(1)
  seatLimit?: number;

  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}

export class CreateSubscriptionDto {
  @IsUUID() planId!: string;
  @IsDateString() startsOn!: string;
  @IsDateString() endsOn!: string;
  @IsOptional() @IsInt() @Min(1) seats?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceOverride?: number;
  @IsOptional() @IsBoolean() autoRenew?: boolean;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RenewSubscriptionDto {
  @IsDateString() endsOn!: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) priceOverride?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class CreatePlatformInvoiceDto {
  @IsUUID() tenantId!: string;
  @IsOptional() @IsUUID() subscriptionId?: string;
  @IsString() @MaxLength(60) invoiceNo!: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsDateString() dueDate!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) subtotal!: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) taxRate?: number;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class RecordPlatformPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount!: number;
  @IsOptional() @IsDateString() paidOn?: string;
  @IsOptional() @IsString() @MaxLength(30) method?: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}
