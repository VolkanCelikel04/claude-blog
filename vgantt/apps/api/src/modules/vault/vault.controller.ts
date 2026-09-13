import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VaultService } from './vault.service';
import { RegisterWorkstationDto, VaultHeartbeatDto } from './vault.dto';
import { NoSecretPayloadGuard } from './no-secret-payload.guard';
import { RequiresModule } from '../../common/licensing/requires-module.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { RequireAudience } from '../../common/auth/decorators';

/**
 * MODULE C - Yerel Şifre Kasası (server-side metadata only)
 *
 * KESİN KURAL: bu controller'da kasa içeriğini kabul eden bir uç nokta YOKTUR
 * ve olmayacaktır. Şifreler, kullanıcı adları ve kasa dosyasının kendisi
 * yalnızca kullanıcının makinesinde, platformun Rsdw klasöründe yaşar
 * (Windows C:/Rsdw, macOS ~/Library/Application Support/Rsdw, Linux
 * ~/.local/share/Rsdw - bkz. docs/SECURITY-VAULT.md).
 *
 * There is deliberately no POST /vault/entries, no sync endpoint and no
 * backup upload. NoSecretPayloadGuard rejects credential-shaped payloads at
 * runtime even if someone later adds a field that would accept one.
 */
@ApiTags('vault')
@Controller('vault')
@RequireAudience('tenant')
@RequiresModule('vault')
@UseGuards(NoSecretPayloadGuard)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get('workstations')
  @RequirePermissions('vault.use')
  @ApiOperation({ summary: 'Kullanıcının kasa kurulu makineleri (yalnızca meta veri)' })
  list() {
    return this.vault.listWorkstations();
  }

  @Put('workstations')
  @RequirePermissions('vault.use')
  @ApiOperation({ summary: 'Makine kaydı: etiket, dosya yolu ve kayıt SAYISI' })
  register(@Body() dto: RegisterWorkstationDto) {
    return this.vault.register(dto);
  }

  @Post('workstations/:id/heartbeat')
  @RequirePermissions('vault.use')
  heartbeat(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VaultHeartbeatDto) {
    return this.vault.heartbeat(id, dto);
  }
}
