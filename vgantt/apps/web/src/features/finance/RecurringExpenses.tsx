import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { currency } from '../../components/charts/chart-theme';

interface ExpenseRow {
  id: string;
  title: string;
  vendor: string | null;
  amount: string;
  currency: string;
  period: string;
  day_of_month: number | null;
  is_active: boolean;
  category_name: string | null;
  open_occurrences: number;
}

interface OccurrenceRow {
  id: string;
  title: string;
  vendor: string | null;
  due_date: string;
  amount: string;
  currency: string;
  status: string;
  days_to_due: number;
  category_name: string | null;
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: 'Haftalık',
  monthly: 'Aylık',
  quarterly: 'Üç aylık',
  yearly: 'Yıllık',
};

export function RecurringExpenses({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();

  const templates = useQuery({
    queryKey: ['finance', 'expenses'],
    queryFn: () => api<ExpenseRow[]>('/finance/expenses'),
  });

  const upcoming = useQuery({
    queryKey: ['finance', 'expenses', 'upcoming'],
    queryFn: () => api<OccurrenceRow[]>('/finance/expenses/upcoming'),
  });

  const pay = useMutation({
    mutationFn: (id: string) => api(`/finance/expenses/occurrences/${id}/pay`, { method: 'POST', body: {} }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  return (
    <div className="grid" style={{ gap: 16 }}>
      <section className="card">
        <header className="card__head">
          <h2 className="card__title">Yaklaşan ödemeler</h2>
          <span className="card__note">Vadesi geçenler kırmızı gösterilir</span>
        </header>

        {upcoming.isLoading ? (
          <p className="empty">Yükleniyor...</p>
        ) : upcoming.data?.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Gider</th>
                  <th>Vade</th>
                  <th>Durum</th>
                  <th className="num">Tutar</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {upcoming.data.map((row) => {
                  const overdue = row.status === 'overdue';
                  return (
                    <tr key={row.id} className={overdue ? 'row--overdue' : undefined}>
                      <td>
                        <strong>{row.title}</strong>
                        {row.vendor ? <div className="muted">{row.vendor}</div> : null}
                      </td>
                      <td className="mono">{new Date(row.due_date).toLocaleDateString('tr-TR')}</td>
                      <td>
                        <span className={`badge badge--${overdue ? 'critical' : row.days_to_due <= 3 ? 'warning' : 'upcoming'}`}>
                          {overdue ? `${Math.abs(row.days_to_due)} gün gecikti` : `${row.days_to_due} gün kaldı`}
                        </span>
                      </td>
                      <td className="num">{currency.format(Number(row.amount))}</td>
                      <td>
                        {canWrite ? (
                          <button type="button" className="button button--ghost" disabled={pay.isPending}
                                  onClick={() => pay.mutate(row.id)}>
                            Ödendi işaretle
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Yaklaşan ödeme yok.</p>
        )}
      </section>

      <section className="card">
        <header className="card__head">
          <h2 className="card__title">Düzenli gider tanımları</h2>
        </header>

        {templates.data?.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Gider</th>
                  <th>Kategori</th>
                  <th>Periyot</th>
                  <th className="num">Tutar</th>
                  <th className="num">Açık taksit</th>
                </tr>
              </thead>
              <tbody>
                {templates.data.map((row) => (
                  <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.55 }}>
                    <td><strong>{row.title}</strong>{row.vendor ? <div className="muted">{row.vendor}</div> : null}</td>
                    <td>{row.category_name ?? '-'}</td>
                    <td>
                      {PERIOD_LABELS[row.period] ?? row.period}
                      {row.day_of_month ? <span className="muted"> · ayın {row.day_of_month}. günü</span> : null}
                    </td>
                    <td className="num">{currency.format(Number(row.amount))}</td>
                    <td className="num">{row.open_occurrences}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Henüz düzenli gider tanımlanmamış.</p>
        )}
      </section>
    </div>
  );
}
