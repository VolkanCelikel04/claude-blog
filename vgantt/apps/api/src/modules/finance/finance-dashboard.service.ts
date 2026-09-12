import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../common/database/tenant-db.service';

export interface MonthlyPoint {
  month: string;
  invoiced: number;
  collected: number;
  expensePaid: number;
  expenseOpen: number;
  netCash: number;
}

/**
 * Everything the finance dashboard charts need, in one round trip.
 * Numbers are returned as numbers (pg returns numeric as string by default),
 * so the frontend never has to guess.
 */
@Injectable()
export class FinanceDashboardService {
  constructor(private readonly db: TenantDb) {}

  async overview() {
    return this.db.withTenant(async (db) => {
      const monthlyRows = await db.query<{
        month: Date; invoiced: string; collected: string;
        expense_paid: string; expense_open: string; net_cash: string;
      }>(
        `SELECT month, invoiced::text, collected::text, expense_paid::text,
                expense_open::text, net_cash::text
           FROM app.v_finance_monthly_summary
          ORDER BY month`,
      );

      const aging = await db.query<{ bucket: string; invoice_count: number; outstanding: string }>(
        `SELECT bucket, invoice_count::int, outstanding::text
           FROM app.v_receivables_aging
          ORDER BY CASE bucket
                     WHEN 'current' THEN 0 WHEN '1-30' THEN 1 WHEN '31-60' THEN 2
                     WHEN '61-90' THEN 3 ELSE 4 END`,
      );

      const [totals] = await db.query<{
        open_receivables: string; overdue_receivables: string; due_within_3_days: string;
        monthly_expense_total: string; unpaid_expense_total: string;
      }>(
        `SELECT
            coalesce((SELECT sum(outstanding) FROM app.v_receivables
                       WHERE status NOT IN ('paid','cancelled')), 0)::text AS open_receivables,
            coalesce((SELECT sum(outstanding) FROM app.v_receivables
                       WHERE risk_bucket = 'overdue'), 0)::text            AS overdue_receivables,
            coalesce((SELECT sum(outstanding) FROM app.v_receivables
                       WHERE risk_bucket IN ('due_today','due_soon')), 0)::text AS due_within_3_days,
            coalesce((SELECT sum(amount) FROM app.recurring_expenses
                       WHERE is_active AND period = 'monthly'), 0)::text   AS monthly_expense_total,
            coalesce((SELECT sum(amount) FROM app.expense_occurrences
                       WHERE status IN ('pending','overdue')), 0)::text    AS unpaid_expense_total`,
      );

      const topDebtors = await db.query<{
        customer_name: string; outstanding: string; overdue_count: number;
      }>(
        `SELECT customer_name, sum(outstanding)::text AS outstanding,
                count(*) FILTER (WHERE risk_bucket = 'overdue')::int AS overdue_count
           FROM app.v_receivables
          WHERE status NOT IN ('paid','cancelled')
          GROUP BY customer_name
          ORDER BY sum(outstanding) DESC
          LIMIT 5`,
      );

      const monthly: MonthlyPoint[] = monthlyRows.map((r) => ({
        month: r.month.toISOString().slice(0, 7),
        invoiced: Number(r.invoiced),
        collected: Number(r.collected),
        expensePaid: Number(r.expense_paid),
        expenseOpen: Number(r.expense_open),
        netCash: Number(r.net_cash),
      }));

      return {
        monthly,
        aging: aging.map((a) => ({
          bucket: a.bucket,
          invoiceCount: a.invoice_count,
          outstanding: Number(a.outstanding),
        })),
        totals: {
          openReceivables: Number(totals.open_receivables),
          overdueReceivables: Number(totals.overdue_receivables),
          dueWithin3Days: Number(totals.due_within_3_days),
          monthlyExpenseTotal: Number(totals.monthly_expense_total),
          unpaidExpenseTotal: Number(totals.unpaid_expense_total),
        },
        topDebtors: topDebtors.map((d) => ({
          customerName: d.customer_name,
          outstanding: Number(d.outstanding),
          overdueCount: d.overdue_count,
        })),
      };
    });
  }
}
