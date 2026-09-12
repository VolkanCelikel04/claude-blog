import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDb } from '../../common/database/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { CreateLicenseDto, LicenseQueryDto, RenewLicenseDto, UpdateLicenseDto } from './licenses.dto';

export interface LicenseRow {
  id: string;
  name: string;
  license_type: string;
  vendor: string | null;
  end_date: Date;
  cost: string | null;
  currency: string;
  auto_renew: boolean;
  status: string;
  days_remaining: number;
  expiry_bucket: string;
  owner_name: string | null;
}

/**
 * Module A. Every query runs through TenantDb.withTenant(), so the tenant
 * filter is applied by PostgreSQL, not by a WHERE clause somebody could forget.
 */
@Injectable()
export class LicensesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(query: LicenseQueryDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    return this.db.withTenant(async (db) => {
      const rows = await db.query<LicenseRow>(
        `SELECT id, name, license_type::text AS license_type, vendor, end_date,
                cost, currency, auto_renew, status::text AS status,
                days_remaining, expiry_bucket, owner_name
           FROM app.v_license_expiry
          WHERE ($1::text IS NULL OR license_type::text = $1)
            AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR vendor ILIKE '%' || $2 || '%')
            AND ($3::int  IS NULL OR days_remaining <= $3)
            AND ($4::text IS NULL OR expiry_bucket = $4)
          ORDER BY end_date ASC
          LIMIT $5 OFFSET $6`,
        [
          query.licenseType ?? null,
          query.search ?? null,
          query.withinDays ?? null,
          query.bucket ?? null,
          limit,
          offset,
        ],
      );

      const [{ count }] = await db.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM app.licenses`,
      );

      return { items: rows, total: Number(count), limit, offset };
    });
  }

  /** Dashboard widget: counts per expiry band, matching the 30/15/7/3 ladder. */
  async summary() {
    return this.db.withTenant(async (db) => {
      const buckets = await db.query<{ expiry_bucket: string; count: string; total_cost: string }>(
        `SELECT expiry_bucket, count(*)::text AS count,
                coalesce(sum(cost), 0)::text AS total_cost
           FROM app.v_license_expiry
          WHERE status = 'active'
          GROUP BY expiry_bucket`,
      );

      const upcoming = await db.query<LicenseRow>(
        `SELECT id, name, license_type::text AS license_type, vendor, end_date,
                cost, currency, auto_renew, status::text AS status,
                days_remaining, expiry_bucket, owner_name
           FROM app.v_license_expiry
          WHERE status = 'active' AND days_remaining <= 30
          ORDER BY days_remaining ASC
          LIMIT 10`,
      );

      return {
        buckets: Object.fromEntries(buckets.map((b) => [b.expiry_bucket, Number(b.count)])),
        costByBucket: Object.fromEntries(buckets.map((b) => [b.expiry_bucket, Number(b.total_cost)])),
        upcoming,
      };
    });
  }

  async findOne(id: string) {
    return this.db.withTenant(async (db) => {
      const license = await db.one(
        `SELECT l.*, u.full_name AS owner_name
           FROM app.licenses l
           LEFT JOIN app.users u ON u.id = l.owner_user_id
          WHERE l.id = $1`,
        [id],
      );
      if (!license) throw new NotFoundException('Lisans kaydı bulunamadı.');

      const renewals = await db.query(
        `SELECT * FROM app.license_renewals WHERE license_id = $1 ORDER BY renewed_at DESC`,
        [id],
      );

      return { ...license, renewals };
    });
  }

  async create(dto: CreateLicenseDto) {
    const { userId } = RequestContextStore.requireTenant();

    const created = await this.db.withTenant(async (db) => {
      // tenant_id is intentionally absent: the BEFORE INSERT trigger stamps it
      // from the session context, so it cannot be spoofed by the payload.
      return db.one<{ id: string; name: string }>(
        `INSERT INTO app.licenses
            (name, license_type, vendor, account_reference, start_date, end_date,
             auto_renew, renewal_months, cost, currency, owner_user_id, tags, notes, created_by)
         VALUES ($1, $2::app.license_type, $3, $4, $5, $6, $7, $8, $9, coalesce($10, 'TRY'),
                 $11, coalesce($12, '{}'), $13, $14)
         RETURNING id, name`,
        [
          dto.name, dto.licenseType, dto.vendor ?? null, dto.accountReference ?? null,
          dto.startDate ?? null, dto.endDate, dto.autoRenew ?? false, dto.renewalMonths ?? null,
          dto.cost ?? null, dto.currency ?? null, dto.ownerUserId ?? null,
          dto.tags ?? null, dto.notes ?? null, userId,
        ],
      );
    });

    await this.audit.record({
      action: 'license.created',
      entityType: 'license',
      entityId: created!.id,
      after: { name: created!.name, endDate: dto.endDate },
    });

    return created;
  }

  async update(id: string, dto: UpdateLicenseDto) {
    const updated = await this.db.withTenant(async (db) => {
      const before = await db.one(`SELECT * FROM app.licenses WHERE id = $1`, [id]);
      if (!before) throw new NotFoundException('Lisans kaydı bulunamadı.');

      // COALESCE keeps this a partial update without building SQL by hand.
      const row = await db.one(
        `UPDATE app.licenses SET
             name              = coalesce($2, name),
             license_type      = coalesce($3::app.license_type, license_type),
             vendor            = coalesce($4, vendor),
             account_reference = coalesce($5, account_reference),
             start_date        = coalesce($6, start_date),
             end_date          = coalesce($7, end_date),
             auto_renew        = coalesce($8, auto_renew),
             renewal_months    = coalesce($9, renewal_months),
             cost              = coalesce($10, cost),
             currency          = coalesce($11, currency),
             owner_user_id     = coalesce($12, owner_user_id),
             tags              = coalesce($13, tags),
             notes             = coalesce($14, notes),
             status            = CASE WHEN coalesce($7, end_date) >= current_date
                                      AND status = 'expired' THEN 'active' ELSE status END
          WHERE id = $1
        RETURNING *`,
        [
          id, dto.name ?? null, dto.licenseType ?? null, dto.vendor ?? null,
          dto.accountReference ?? null, dto.startDate ?? null, dto.endDate ?? null,
          dto.autoRenew ?? null, dto.renewalMonths ?? null, dto.cost ?? null,
          dto.currency ?? null, dto.ownerUserId ?? null, dto.tags ?? null, dto.notes ?? null,
        ],
      );

      return { before, after: row };
    });

    await this.audit.record({
      action: 'license.updated',
      entityType: 'license',
      entityId: id,
      before: updated.before,
      after: updated.after,
    });

    return updated.after;
  }

  /**
   * Renewing pushes the end date forward and records the history. Because the
   * notification dedupe key embeds the due date, this automatically opens a
   * fresh 30/15/7/3 warning ladder for the new period.
   */
  async renew(id: string, dto: RenewLicenseDto) {
    const { userId } = RequestContextStore.requireTenant();

    const result = await this.db.withTenant(async (db) => {
      const license = await db.one<{ end_date: Date; name: string }>(
        `SELECT end_date, name FROM app.licenses WHERE id = $1`,
        [id],
      );
      if (!license) throw new NotFoundException('Lisans kaydı bulunamadı.');

      await db.execute(
        `INSERT INTO app.license_renewals
            (license_id, previous_end_date, new_end_date, cost, renewed_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, license.end_date, dto.newEndDate, dto.cost ?? null, userId, dto.notes ?? null],
      );

      return db.one(
        `UPDATE app.licenses
            SET end_date = $2, status = 'active', cost = coalesce($3, cost)
          WHERE id = $1
        RETURNING *`,
        [id, dto.newEndDate, dto.cost ?? null],
      );
    });

    await this.audit.record({
      action: 'license.renewed',
      entityType: 'license',
      entityId: id,
      after: { newEndDate: dto.newEndDate },
    });

    return result;
  }

  async remove(id: string) {
    const deleted = await this.db.withTenant(async (db) => {
      const count = await db.execute(`DELETE FROM app.licenses WHERE id = $1`, [id]);
      if (count === 0) throw new NotFoundException('Lisans kaydı bulunamadı.');
      return count;
    });

    await this.audit.record({ action: 'license.deleted', entityType: 'license', entityId: id });
    return { deleted };
  }
}
