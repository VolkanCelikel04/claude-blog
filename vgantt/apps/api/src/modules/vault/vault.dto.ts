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

  /**
   * Where the local file lives. A path, not its contents.
   *
   * Accepts a Windows drive path (C:/Rsdw/vault.xlsx) or a POSIX absolute path
   * (macOS, Linux and the mobile sandboxes all report one). Relative paths and
   * traversal are rejected: this value is only ever displayed back to support,
   * but a path that cannot be trusted should not be stored in the first place.
   */
  @IsOptional()
  @IsString()
  @MaxLength(260)
  @Matches(/^(?:[A-Za-z]:[\\/]|\/)(?!.*\.\.)[^<>"|?*\u0000]*$/, {
    message:
      'Kasa yolu mutlak bir dizin olmalıdır (ör. C:/Rsdw/vault.xlsx veya ' +
      '/Users/ad/Library/Application Support/Rsdw/vault.xlsx).',
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
