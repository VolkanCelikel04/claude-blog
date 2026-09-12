import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-store';
import { StatTile } from '../../components/charts/StatTile';
import { CashFlowChart } from '../../components/charts/CashFlowChart';
import { ReceivablesAgingChart } from '../../components/charts/ReceivablesAgingChart';
import { currency } from '../../components/charts/chart-theme';
import { ReceivablesTable } from './ReceivablesTable';
import { RecurringExpenses } from './RecurringExpenses';
import type { FinanceOverview, ReceivableRow } from '../../lib/types';

type Tab = 'overview' | 'receivables' | 'expenses';

/** MODULE B - düzenli giderler, müşteri alacakları ve finansal özet. */
export default function FinancePage() {
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('overview');

  const overview = useQuery({
    queryKey: ['finance', 'dashboard'],
    queryFn: () => api<FinanceOverview>('/finance/dashboard'),
  });

  const receivables = useQuery({
    queryKey: ['finance', 'invoices'],
    queryFn: () =>
      api<{ items: ReceivableRow[]; totals: Record<string, number> }>('/finance/invoices', {
        query: { onlyOpen: true, limit: 100 },
      }),
  });

  const recordPayment = useMutation({
    mutationFn: ({ id, amount }: { id: string; amount: number }) =>
      api(`/finance/invoices/${id}/payments`, { method: 'POST', body: { amount } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const totals = overview.data?.totals;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Finans ve Ödeme Takibi</h1>
          <p className="page-subtitle">
            Düzenli giderler, müşteri alacakları ve tahsilat durumu. Vadeye 3 gün kala otomatik hatırlatma üretilir.
          </p>
        </div>
      </header>

      <div className="grid grid--kpi" style={{ marginBottom: 20 }}>
        <StatTile
          label="Geciken alacak"
          value={totals ? currency.format(totals.overdueReceivables) : '-'}
          hint={`${receivables.data?.totals.overdueCount ?? 0} fatura`}
          tone={(totals?.overdueReceivables ?? 0) > 0 ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Toplam açık alacak"
          value={totals ? currency.format(totals.openReceivables) : '-'}
          hint={`${receivables.data?.totals.openCount ?? 0} fatura`}
        />
        <StatTile
          label="3 gün içinde vadesi gelen"
          value={totals ? currency.format(totals.dueWithin3Days) : '-'}
          hint="Hatırlatma üretildi"
          tone={(totals?.dueWithin3Days ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Aylık düzenli gider"
          value={totals ? currency.format(totals.monthlyExpenseTotal) : '-'}
          hint={totals ? `${currency.format(totals.unpaidExpenseTotal)} ödenmemiş` : undefined}
        />
      </div>

      <div className="toolbar" role="tablist" aria-label="Finans görünümü">
        {([
          ['overview', 'Özet'],
          ['receivables', 'Alacaklar'],
          ['expenses', 'Düzenli giderler'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'button button--primary' : 'button'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        overview.isLoading ? (
          <p className="empty">Yükleniyor...</p>
        ) : overview.data ? (
          <div className="grid grid--halves">
            <CashFlowChart monthly={overview.data.monthly} />
            <ReceivablesAgingChart aging={overview.data.aging} />
          </div>
        ) : null
      ) : null}

      {tab === 'receivables' ? (
        <ReceivablesTable
          rows={receivables.data?.items ?? []}
          loading={receivables.isLoading}
          canRecordPayment={can('finance.payment.write')}
          onRecordPayment={(row) => {
            const outstanding = Number(row.outstanding);
            const input = window.prompt(
              `${row.invoice_no} için tahsilat tutarı (kalan ${currency.format(outstanding)})`,
              String(outstanding),
            );
            if (!input) return;
            const amount = Number(input.replace(',', '.'));
            if (Number.isFinite(amount) && amount > 0) recordPayment.mutate({ id: row.id, amount });
          }}
        />
      ) : null}

      {tab === 'expenses' ? <RecurringExpenses canWrite={can('finance.expense.write')} /> : null}
    </>
  );
}
