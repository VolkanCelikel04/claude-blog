import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AppConfig } from '../config/configuration';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const auth = config.getOrThrow<AppConfig['auth']>('auth');
        return {
          secret: auth.jwtSecret,
          signOptions: { expiresIn: auth.accessTtl, issuer: 'vgantt' },
          verifyOptions: { issuer: 'vgantt' },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, SessionService, JwtAuthGuard],
  exports: [AuthService, PasswordService, SessionService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
