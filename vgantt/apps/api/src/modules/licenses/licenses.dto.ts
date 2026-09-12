import {
  IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional,
  IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export const LICENSE_TYPES = [
  'software', 'domain', 'ssl_certificate', 'hosting', 'subscription',
  'hardware_warranty', 'insurance', 'certification', 'other',
] as const;
export type LicenseType = (typeof LICENSE_TYPES)[number];

export class CreateLicenseDto {
  @IsString() @MinLength(2) @MaxLength(200)
  name!: string;

  @IsEnum(LICENSE_TYPES, { message: 'Geçersiz lisans türü.' })
  licenseType!: LicenseType;

  @IsOptional() @IsString() @MaxLength(200)
  vendor?: string;

  /** Vendor account or customer number. Never a password - see module C. */
  @IsOptional() @IsString() @MaxLength(120)
  accountReference?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsDateString({}, { message: 'Bitiş tarihi zorunludur.' })
  endDate!: string;

  @IsOptional() @IsBoolean()
  autoRenew?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(120)
  renewalMonths?: number;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  cost?: number;

  @IsOptional() @IsString() @MaxLength(3)
  currency?: string;

  @IsOptional() @IsUUID()
  ownerUserId?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsString() @MaxLength(2000)
  notes?: string;
}

export class UpdateLicenseDto extends CreateLicenseDto {
  @IsOptional()
  declare name: string;

  @IsOptional()
  declare licenseType: LicenseType;

  @IsOptional()
  declare endDate: string;
}

export class RenewLicenseDto {
  @IsDateString()
  newEndDate!: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  cost?: number;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

export class LicenseQueryDto {
  @IsOptional() @IsEnum(LICENSE_TYPES)
  licenseType?: LicenseType;

  @IsOptional() @IsString()
  search?: string;

  /** Only items expiring within N days. */
  @IsOptional() @IsInt() @Min(0) @Max(3650)
  withinDays?: number;

  @IsOptional() @IsString()
  bucket?: 'expired' | 'critical' | 'urgent' | 'warning' | 'upcoming' | 'ok';

  @IsOptional() @IsInt() @Min(1) @Max(200)
  limit?: number;

  @IsOptional() @IsInt() @Min(0)
  offset?: number;
}
