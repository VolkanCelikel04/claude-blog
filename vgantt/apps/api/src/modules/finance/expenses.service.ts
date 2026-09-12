import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantDb } from '../../common/database/tenant-db.service';
import { AuditService } from '../../common/audit/audit.service';
import { CreateRecurringExpenseDto, PayOccurrenceDto } from './finance.dto';

/**
 * "Aylık düzenli ödemeler".
 *
 * A recurring expense is a template; app.expense_occurrences holds one row per
 * period so that "did we pay this month's rent?" has an answer, and so the
 * warning ladder has a concrete due date to count down to.
 */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.db.withTenant(async (db) =>
      db.query(
        `SELECT e.*, c.name AS category_name, c.color AS category_color,
                (SELECT count(*) FROM app.expense_occurrences o
                  WHERE o.recurring_expense_id = e.id AND o.status IN ('pending','overdue'))::int
                  AS open_occurrences
           FROM app.recurring_expenses e
           LEFT JOIN app.finance_categories c ON c.id = e.category_id
          ORDER BY e.is_active DESC, e.title`,
      ),
    );
  }

  /** Upcoming and overdue instalments - what the dashboard list shows. */
  async upcoming(withinDays = 45) {
    return this.db.withTenant(async (db) =>
      db.query(
        `SELECT o.id, o.due_date, o.amount, o.currency, o.status::text AS status,
                (o.due_date - current_date) AS days_to_due,
                e.title, e.vendor, c.name AS category_name, c.color AS category_color
           FROM app.expense_occurrences o
           JOIN app.recurring_expenses e ON e.id = o.recurring_expense_id
           LEFT JOIN app.finance_categories c ON c.id = e.category_id
          WHERE o.status IN ('pending', 'overdue')
            AND o.due_date <= current_date + $1::int
          ORDER BY o.due_date ASC`,
        [withinDays],
      ),
    );
  }

  async create(dto: CreateRecurringExpenseDto) {
    const created = await this.db.withTenant(async (db) => {
      const row = await db.one<{ id: string }>(
        `INSERT INTO app.recurring_expenses
            (title, category_id, vendor, amount, currency, period, day_of_month,
             start_date, end_date, payment_method, notes)
         VALUES ($1, $2, $3, $4, coalesce($5,'TRY'), $6::app.expense_period, $7,
                 coalesce($8, current_date), $9, $10, $11)
         RETURNING id`,
        [
          dto.title, dto.categoryId ?? null, dto.vendor ?? null, dto.amount,
          dto.currency ?? null, dto.period, dto.dayOfMonth ?? null,
          dto.startDate ?? null, dto.endDate ?? null, dto.paymentMethod ?? null,
          dto.notes ?? null,
        ],
      );

      // Materialise the next three months immediately so the new expense shows
      // up on the dashboard without waiting for the nightly job. The _my_
      // variant is tenant-scoped: the bulk generator runs for every tenant and
      // is reserved for the scheduler (the tenant role has no grant on it).
      await db.execute(`SELECT app.generate_my_expense_occurrences(90)`);
      return row;
    });

    await this.audit.record({
      action: 'finance.expense.created',
      entityType: 'recurring_expense',
      entityId: created!.id,
      after: { title: dto.title, amount: dto.amount, period: dto.period },
    });

    return created;
  }

  async markPaid(occurrenceId: string, dto: PayOccurrenceDto) {
    const result = await this.db.withTenant(async (db) => {
      const row = await db.one(
        `UPDATE app.expense_occurrences
            SET status = 'paid',
                paid_on = coalesce($2::date, current_date),
                paid_amount = coalesce($3, amount),
                reference = coalesce($4, reference)
          WHERE id = $1
        RETURNING *`,
        [occurrenceId, dto.paidOn ?? null, dto.paidAmount ?? null, dto.reference ?? null],
      );
      if (!row) throw new NotFoundException('Ödeme kaydı bulunamadı.');
      return row;
    });

    await this.audit.record({
      action: 'finance.expense.paid',
      entityType: 'expense_occurrence',
      entityId: occurrenceId,
      after: result,
    });

    return result;
  }

  async remove(id: string) {
    const deleted = await this.db.withTenant(async (db) => {
      const count = await db.execute(`DELETE FROM app.recurring_expenses WHERE id = $1`, [id]);
      if (count === 0) throw new NotFoundException('Gider kaydı bulunamadı.');
      return count;
    });
    await this.audit.record({
      action: 'finance.expense.deleted',
      entityType: 'recurring_expense',
      entityId: id,
    });
    return { deleted };
  }

  async categories() {
    return this.db.withTenant(async (db) =>
      db.query(`SELECT * FROM app.finance_categories WHERE is_active ORDER BY kind, name`),
    );
  }
}
