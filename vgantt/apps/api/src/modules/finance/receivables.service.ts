import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDb } from '../../common/database/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { RequestContextStore } from '../../common/context/request-context';
import { CreateCustomerDto, CreateInvoiceDto, ReceivableQueryDto, RecordPaymentDto } from './finance.dto';

export interface ReceivableRow {
  id: string;
  invoice_no: string;
  customer_name: string;
  issue_date: Date;
  due_date: Date;
  total: string;
  paid_amount: string;
  outstanding: string;
  currency: string;
  status: string;
  days_to_due: number;
  days_overdue: number;
  /** overdue | due_today | due_soon | upcoming | scheduled | paid | cancelled
   *  The UI paints "overdue" red - see apps/web/src/features/finance. */
  risk_bucket: string;
}

/**
 * "Müşteri ödeme takibi (alacaklar)".
 *
 * Invoice status is never written directly: it is recomputed by a database
 * trigger from the payment ledger, so partial payments, refunds and the
 * nightly overdue sweep can never disagree with each other.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(query: ReceivableQueryDto) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    return this.db.withTenant(async (db) => {
      const items = await db.query<ReceivableRow>(
        `SELECT * FROM app.v_receivables
          WHERE ($1::text IS NULL OR risk_bucket = $1)
            AND ($2::uuid IS NULL OR customer_id = $2)
            AND ($3::boolean IS NOT TRUE OR status NOT IN ('paid', 'cancelled'))
          ORDER BY
            CASE risk_bucket
              WHEN 'overdue'   THEN 0
              WHEN 'due_today' THEN 1
              WHEN 'due_soon'  THEN 2
              ELSE 3 END,
            due_date ASC
          LIMIT $4 OFFSET $5`,
        [query.riskBucket ?? null, query.customerId ?? null, query.onlyOpen ?? null, limit, offset],
      );

      const [totals] = await db.query<{
        open_total: string; overdue_total: string; open_count: string; overdue_count: string;
      }>(
        `SELECT coalesce(sum(outstanding), 0)::text AS open_total,
                coalesce(sum(outstanding) FILTER (WHERE risk_bucket = 'overdue'), 0)::text AS overdue_total,
                count(*)::text AS open_count,
                count(*) FILTER (WHERE risk_bucket = 'overdue')::text AS overdue_count
           FROM app.v_receivables
          WHERE status NOT IN ('paid', 'cancelled')`,
      );

      return {
        items,
        totals: {
          openTotal: Number(totals.open_total),
          overdueTotal: Number(totals.overdue_total),
          openCount: Number(totals.open_count),
          overdueCount: Number(totals.overdue_count),
        },
        limit,
        offset,
      };
    });
  }

  async findOne(id: string) {
    return this.db.withTenant(async (db) => {
      const invoice = await db.one(`SELECT * FROM app.v_receivables WHERE id = $1`, [id]);
      if (!invoice) throw new NotFoundException('Fatura bulunamadı.');

      const payments = await db.query(
        `SELECT * FROM app.customer_payments WHERE invoice_id = $1 ORDER BY paid_on DESC`,
        [id],
      );
      return { ...invoice, payments };
    });
  }

  async createInvoice(dto: CreateInvoiceDto) {
    const { userId } = RequestContextStore.requireTenant();

    const created = await this.db.withTenant(async (db) =>
      db.one<{ id: string; invoice_no: string; total: string }>(
        `INSERT INTO app.customer_invoices
            (customer_id, invoice_no, description, issue_date, due_date, amount, tax_rate, currency, created_by)
         VALUES ($1, $2, $3, coalesce($4::date, current_date), $5, $6, coalesce($7, 20.00),
                 coalesce($8, 'TRY'), $9)
         RETURNING id, invoice_no, total`,
        [
          dto.customerId, dto.invoiceNo, dto.description ?? null, dto.issueDate ?? null,
          dto.dueDate, dto.amount, dto.taxRate ?? null, dto.currency ?? null, userId,
        ],
      ),
    );

    await this.audit.record({
      action: 'finance.invoice.created',
      entityType: 'customer_invoice',
      entityId: created!.id,
      after: { invoiceNo: created!.invoice_no, total: created!.total, dueDate: dto.dueDate },
    });

    return created;
  }

  async recordPayment(invoiceId: string, dto: RecordPaymentDto) {
    const { userId } = RequestContextStore.requireTenant();

    const result = await this.db.withTenant(async (db) => {
      const invoice = await db.one<{ id: string }>(
        `SELECT id FROM app.customer_invoices WHERE id = $1`,
        [invoiceId],
      );
      if (!invoice) throw new NotFoundException('Fatura bulunamadı.');

      await db.execute(
        `INSERT INTO app.customer_payments
            (invoice_id, amount, paid_on, method, reference, recorded_by, notes)
         VALUES ($1, $2, coalesce($3::date, current_date), coalesce($4::platform.payment_method,'bank_transfer'),
                 $5, $6, $7)`,
        [
          invoiceId, dto.amount, dto.paidOn ?? null, dto.method ?? null,
          dto.reference ?? null, userId, dto.notes ?? null,
        ],
      );

      // The trigger has recalculated status/paid_amount by now.
      return db.one(`SELECT * FROM app.v_receivables WHERE id = $1`, [invoiceId]);
    });

    await this.audit.record({
      action: 'finance.payment.recorded',
      entityType: 'customer_invoice',
      entityId: invoiceId,
      after: { amount: dto.amount, status: (result as { status?: string })?.status },
    });

    return result;
  }

  async cancelInvoice(id: string, reason?: string) {
    const result = await this.db.withTenant(async (db) => {
      const row = await db.one(
        `UPDATE app.customer_invoices SET status = 'cancelled'
          WHERE id = $1 AND status <> 'paid'
        RETURNING id, invoice_no, status::text AS status`,
        [id],
      );
      if (!row) throw new NotFoundException('Fatura bulunamadı veya ödenmiş bir fatura iptal edilemez.');
      return row;
    });

    await this.audit.record({
      action: 'finance.invoice.cancelled',
      entityType: 'customer_invoice',
      entityId: id,
      after: { reason },
    });

    return result;
  }

  // ------------------------------------------------------------- customers
  async listCustomers() {
    return this.db.withTenant(async (db) =>
      db.query(
        `SELECT c.*,
                coalesce(sum(r.outstanding) FILTER (WHERE r.status NOT IN ('paid','cancelled')), 0)::text
                  AS open_balance,
                count(r.id) FILTER (WHERE r.risk_bucket = 'overdue')::int AS overdue_count
           FROM app.customers c
           LEFT JOIN app.v_receivables r ON r.customer_id = c.id
          WHERE c.is_active
          GROUP BY c.id
          ORDER BY c.name`,
      ),
    );
  }

  async createCustomer(dto: CreateCustomerDto) {
    const created = await this.db.withTenant(async (db) =>
      db.one<{ id: string }>(
        `INSERT INTO app.customers (name, email, phone, tax_office, tax_number, address)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [dto.name, dto.email ?? null, dto.phone ?? null, dto.taxOffice ?? null,
         dto.taxNumber ?? null, dto.address ?? null],
      ),
    );

    await this.audit.record({
      action: 'finance.customer.created',
      entityType: 'customer',
      entityId: created!.id,
      after: { name: dto.name },
    });

    return created;
  }
}
