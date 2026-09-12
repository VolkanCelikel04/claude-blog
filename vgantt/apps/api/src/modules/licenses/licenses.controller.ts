import {
  Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LicensesService } from './licenses.service';
import { CreateLicenseDto, LicenseQueryDto, RenewLicenseDto, UpdateLicenseDto } from './licenses.dto';
import { RequiresModule } from '../../common/licensing/requires-module.decorator';
import { RequirePermissions } from '../../common/rbac/permissions.decorator';
import { RequireAudience } from '../../common/auth/decorators';

/**
 * MODULE A - Lisans ve Süre Takibi
 *
 * @RequiresModule('licenses') makes every route below return 402 when
 * VganttAdmin has the module switched off for the caller's tenant.
 */
@ApiTags('licenses')
@Controller('licenses')
@RequireAudience('tenant')
@RequiresModule('licenses')
export class LicensesController {
  constructor(private readonly licenses: LicensesService) {}

  @Get()
  @RequirePermissions('licenses.read')
  @ApiOperation({ summary: 'Lisans listesi (filtrelenebilir)' })
  list(@Query() query: LicenseQueryDto) {
    return this.licenses.list(query);
  }

  @Get('summary')
  @RequirePermissions('licenses.read')
  @ApiOperation({ summary: 'Dashboard özeti: 30/15/7/3 gün bantlarına göre sayılar' })
  summary() {
    return this.licenses.summary();
  }

  @Get(':id')
  @RequirePermissions('licenses.read')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.licenses.findOne(id);
  }

  @Post()
  @RequirePermissions('licenses.write')
  create(@Body() dto: CreateLicenseDto) {
    return this.licenses.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('licenses.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLicenseDto) {
    return this.licenses.update(id, dto);
  }

  @Post(':id/renew')
  @RequirePermissions('licenses.renew')
  @ApiOperation({ summary: 'Lisansı yenile; yeni uyarı merdiveni otomatik başlar' })
  renew(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RenewLicenseDto) {
    return this.licenses.renew(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('licenses.delete')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.licenses.remove(id);
  }
}
