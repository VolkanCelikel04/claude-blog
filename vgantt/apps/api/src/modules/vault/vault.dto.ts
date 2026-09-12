import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * The complete set of vault data the server is allowed to receive.
 *
 * There is no field for an entry, a username, a password, a salt, a key or a
 * file body - by design. If you are about to add one, read
 * docs/SECURITY-VAULT.md first: the answer is no.
 */
export class RegisterWorkstationDto {
  /** Human-readable machine name, e.g. "VOLKAN-PC". */
  @IsString() @MinLength(1) @MaxLength(100)
  deviceLabel!: string;

  /** Where the local file lives. A path, not its contents. */
  @IsOptional()
  @IsString()
  @MaxLength(260)
  @Matches(/^[A-Za-z]:[\\/][^<>"|?*]*$/, {
    message: 'Kasa yolu geçerli bir Windows dizini olmalıdır (ör. C:/Rsdw/vault.xlsx).',
  })
  vaultPath?: string;

  /** How many entries the file holds. A count carries no secret. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  entryCount?: number;
}

export class VaultHeartbeatDto {
  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  entryCount?: number;

  @IsOptional() @IsString() @MaxLength(30)
  event?: 'opened' | 'saved' | 'backed_up';
}
