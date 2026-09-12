import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlatformDb } from '../database/platform-db.service';
import { Public } from '../auth/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly db: PlatformDb) {}

  @Public()
  @Get()
  async health() {
    const [{ now }] = await this.db.query<{ now: Date }>('SELECT now() AS now');
    return { status: 'ok', time: now };
  }

  /**
   * Verifies the module C invariant on a live database: no credential-shaped
   * column exists outside the reviewed allow-list. Exposed so that monitoring
   * can assert the guarantee continuously, not just at migration time.
   */
  @Public()
  @Get('vault-policy')
  @ApiOperation({ summary: 'Şifre kasası kuralı: veritabanında kimlik bilgisi kolonu var mı?' })
  async vaultPolicy() {
    const violations = await this.db.query<{
      schema_name: string; table_name: string; column_name: string;
    }>('SELECT * FROM platform.check_no_secret_columns()');

    return {
      compliant: violations.length === 0,
      violations,
      statement:
        'Şifre kasası verileri yalnızca kullanıcının makinesinde (C:/Rsdw) saklanır; ' +
        'veritabanında kimlik bilgisi tutulmaz.',
    };
  }
}
