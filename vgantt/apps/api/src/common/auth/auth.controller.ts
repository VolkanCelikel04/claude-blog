import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AdminLoginDto, RefreshDto, TenantLoginDto } from './dto/auth.dto';
import { Ctx, Public, RequireAudience } from './decorators';
import { RequestContext } from '../context/request-context';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tenant kullanıcı girişi' })
  async login(@Body() dto: TenantLoginDto, @Req() req: Request) {
    const { tokens, session } = await this.auth.loginTenantUser(
      dto.email,
      dto.password,
      dto.tenantSlug,
      { ip: req.ip, userAgent: req.headers['user-agent'] },
    );
    return { ...tokens, session };
  }

  @Public()
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'VganttAdmin operatör girişi' })
  async adminLogin(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const { tokens, session } = await this.auth.loginAdmin(dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return { ...tokens, session };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  /**
   * The frontend calls this on boot: it returns the permissions AND the
   * licensed modules, which is exactly what the menu is rendered from.
   */
  @Get('me')
  @RequireAudience('tenant')
  async me(@Ctx() ctx: RequestContext) {
    const session = await this.sessions.loadTenantSession(ctx.userId!);
    return session;
  }
}
