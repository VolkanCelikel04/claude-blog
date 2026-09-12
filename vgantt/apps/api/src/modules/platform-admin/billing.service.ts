import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformDb } from '../../common/database/platform-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { CreatePlatformInvoiceDto, RecordPlatformPaymentDto } from './platform-admin.dto';

/** Tenant bazlı ödeme ve abonelik takibi (VganttAdmin -> tenant billing). */
@Injectable()
export class BillingService {
  constructor(
    private readonly db: PlatformDb,
    private readonly audit: AuditService,
  ) {}

  async listInvoices(params: { tenantId?: string; status?: string; overdueOnly?: boolean }) {
    return this.db.query(
      `SELECT i.*, t.name AS tenant_name, t.slug::text AS tenant_slug,
              coalesce((SELECT sum(p.amount) FROM platform.payments p WHERE p.invoice_id = i.id), 0)::text
                AS paid_amount,
              (i.due_date - current_date) AS days_to_due
         FROM platform.invoices i
         JOIN platform.tenants t ON t.id = i.tenant_id
        WHERE ($1::uuid IS NULL OR i.tenant_id = $1)
          AND ($2::text IS NULL OR i.status::text = $2)
          AND ($3::boolean IS NOT TRUE OR (i.due_date < current_date AND i.status <> 'paid'))
        ORDER BY i.due_date ASC`,
      [params.tenantId ?? null, params.status ?? null, params.overdueOnly ?? null],
    );
  }

  async createInvoice(dto: CreatePlatformInvoiceDto) {
    const created = await this.db.one<{ id: string; invoice_no: string; total: string }>(
      `INSERT INTO platform.invoices
          (tenant_id, subscription_id, invoice_no, issue_date, due_date, subtotal, tax_rate, status, notes)
       VALUES ($1, $2, $3, coalesce($4::date, current_date), $5, $6, coalesce($7, 20.00), 'sent', $8)
       RETURNING id, invoice_no, total`,
      [dto.tenantId, dto.subscriptionId ?? null, dto.invoiceNo, dto.issueDate ?? null,
       dto.dueDate, dto.subtotal, dto.taxRate ?? null, dto.notes ?? null],
    );

    await this.audit.record({
      action: 'billing.invoice.created',
      entityType: 'platform_invoice',
      entityId: created!.id,
      tenantId: dto.tenantId,
      after: created,
    });
    return created;
  }

  async recordPayment(invoiceId: string, dto: RecordPlatformPaymentDto) {
    const ctx = RequestContextStore.get();

    const invoice = await this.db.one<{ tenant_id: string }>(
      `SELECT tenant_id FROM platform.invoices WHERE id = $1`,
      [invoiceId],
    );
    if (!invoice) throw new NotFoundException('Fatura bulunamadı.');

    await this.db.execute(
      `INSERT INTO platform.payments (tenant_id, invoice_id, amount, paid_on, method, reference, recorded_by)
       VALUES ($1, $2, $3, coalesce($4::date, current_date),
               coalesce($5::platform.payment_method, 'bank_transfer'), $6, $7)`,
      [invoice.tenant_id, invoiceId, dto.amount, dto.paidOn ?? null, dto.method ?? null,
       dto.reference ?? null, ctx?.adminUserId ?? null],
    );

    // The trigger recalculated the invoice status.
    const updated = await this.db.one(
      `SELECT id, invoice_no, status::text AS status, total, paid_at
         FROM platform.invoices WHERE id = $1`,
      [invoiceId],
    );

    await this.audit.record({
      action: 'billing.payment.recorded',
      entityType: 'platform_invoice',
      entityId: invoiceId,
      tenantId: invoice.tenant_id,
      after: { amount: dto.amount, status: (updated as { status?: string })?.status },
    });

    return updated;
  }

  async revenueSummary() {
    const monthly = await this.db.query(
      `SELECT to_char(month, 'YYYY-MM') AS month, collected::text, paying_tenants
         FROM platform.v_revenue_monthly ORDER BY month`,
    );
    const [totals] = await this.db.query<Record<string, string>>(
      `SELECT
         coalesce(sum(total) FILTER (WHERE status = 'paid'), 0)::text     AS collected_total,
         coalesce(sum(total) FILTER (WHERE status <> 'paid' AND status <> 'void'), 0)::text AS open_total,
         coalesce(sum(total) FILTER (WHERE status = 'overdue'), 0)::text  AS overdue_total,
         count(*) FILTER (WHERE status = 'overdue')::text                 AS overdue_count
       FROM platform.invoices`,
    );

    return {
      monthly: monthly.map((m) => ({
        month: m.month as string,
        collected: Number(m.collected),
        payingTenants: Number(m.paying_tenants),
      })),
      totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Number(v)])),
    };
  }
}
