import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class TenantLoginDto {
  @IsEmail({}, { message: 'Geçerli bir e-posta adresi girin.' })
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty({ message: 'Şifre boş olamaz.' })
  @MaxLength(256)
  password!: string;

  /** Required only when the same e-mail exists in more than one company. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tenantSlug?: string;
}

export class AdminLoginDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(10, { message: 'Yeni şifre en az 10 karakter olmalıdır.' })
  @MaxLength(256)
  newPassword!: string;
}
