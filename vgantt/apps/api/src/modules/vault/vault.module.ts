import { Module } from '@nestjs/common';
import { VaultController } from './vault.controller';
import { VaultService } from './vault.service';
import { NoSecretPayloadGuard } from './no-secret-payload.guard';

@Module({
  controllers: [VaultController],
  providers: [VaultService, NoSecretPayloadGuard],
})
export class VaultModule {}
