import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDb } from '../../common/database/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { RegisterWorkstationDto, VaultHeartbeatDto } from './vault.dto';

/**
 * MODULE C, server side.
 *
 * The entire server-side surface of the password vault is this file, and all it
 * does is remember that a workstation exists so support can answer "hangi
 * makinede kasam var?". The vault contents are handled exclusively by
 * packages/vault-core running inside the Electron shell.
 */
@Injectable()
export class VaultService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async listWorkstations() {
    const { userId } = RequestContextStore.requireTenant();
    return this.db.withTenant(async (db) =>
      db.query(
        `SELECT id, device_label, vault_path, entry_count, last_opened_at, last_backup_at, created_at
           FROM app.vault_workstations
          WHERE user_id = $1
          ORDER BY last_opened_at DESC NULLS LAST`,
        [userId],
      ),
    );
  }

  async register(dto: RegisterWorkstationDto) {
    const { userId } = RequestContextStore.requireTenant();

    const row = await this.db.withTenant(async (db) =>
      db.one<{ id: string }>(
        `INSERT INTO app.vault_workstations (user_id, device_label, vault_path, entry_count)
         VALUES ($1, $2, coalesce($3, 'C:/Rsdw/vault.xlsx'), coalesce($4, 0))
         ON CONFLICT (user_id, device_label) DO UPDATE
             SET vault_path = EXCLUDED.vault_path,
                 entry_count = EXCLUDED.entry_count,
                 last_opened_at = now()
         RETURNING id`,
        [userId, dto.deviceLabel, dto.vaultPath ?? null, dto.entryCount ?? null],
      ),
    );

    await this.audit.record({
      action: 'vault.workstation.registered',
      entityType: 'vault_workstation',
      entityId: row!.id,
      // Note what is recorded: a label and a count. Never an entry.
      after: { deviceLabel: dto.deviceLabel, entryCount: dto.entryCount ?? 0 },
    });

    return row;
  }

  async heartbeat(id: string, dto: VaultHeartbeatDto) {
    const { userId } = RequestContextStore.requireTenant();

    const updated = await this.db.withTenant(async (db) => {
      const row = await db.one(
        `UPDATE app.vault_workstations
            SET entry_count = coalesce($3, entry_count),
                last_opened_at = now(),
                last_backup_at = CASE WHEN $4 = 'backed_up' THEN now() ELSE last_backup_at END
          WHERE id = $1 AND user_id = $2
        RETURNING id, device_label, entry_count, last_opened_at, last_backup_at`,
        [id, userId, dto.entryCount ?? null, dto.event ?? null],
      );
      if (!row) throw new NotFoundException('Kayıtlı iş istasyonu bulunamadı.');
      return row;
    });

    return updated;
  }
}
