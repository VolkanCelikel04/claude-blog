import { currency } from '../../components/charts/chart-theme';
import type { ReceivableRow } from '../../lib/types';

const RISK_LABELS: Record<ReceivableRow['risk_bucket'], string> = {
  overdue: 'Gecikti',
  due_today: 'Bugün vadesi',
  due_soon: '3 gün içinde',
  upcoming: 'Bu hafta',
  scheduled: 'Planlı',
  paid: 'Ödendi',
  cancelled: 'İptal',
};

interface Props {
  rows: ReceivableRow[];
  loading: boolean;
  canRecordPayment: boolean;
  onRecordPayment(row: ReceivableRow): void;
}

/**
 * Overdue rows are highlighted in red, as the brief asks - and also carry the
 * word "Gecikti" and the day count, so the state never depends on colour alone.
 */
export function ReceivablesTable({ rows, loading, canRecordPayment, onRecordPayment }: Props) {
  if (loading) return <p className="empty">Yükleniyor...</p>;
  if (rows.length === 0) return <p className="empty">Açık alacak bulunmuyor.</p>;

  return (
    <section className="card">
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th>Fatura</th>
              <th>Müşteri</th>
              <th>Vade</th>
              <th>Durum</th>
              <th className="num">Tutar</th>
              <th className="num">Ödenen</th>
              <th className="num">Kalan</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOverdue = row.risk_bucket === 'overdue';
              return (
                <tr key={row.id} className={isOverdue ? 'row--overdue' : undefined}>
                  <td className="mono">{row.invoice_no}</td>
                  <td>{row.customer_name}</td>
                  <td className="mono">{new Date(row.due_date).toLocaleDateString('tr-TR')}</td>
                  <td>
                    <span className={`badge badge--${badgeClass(row.risk_bucket)}`}>
                      {RISK_LABELS[row.risk_bucket]}
                      {isOverdue ? <span className="mono"> · {row.days_overdue} gün</span> : null}
                      {row.risk_bucket === 'due_soon' ? <span className="mono"> · {row.days_to_due} gün</span> : null}
                    </span>
                  </td>
                  <td className="num">{currency.format(Number(row.total))}</td>
                  <td className="num">{currency.format(Number(row.paid_amount))}</td>
                  <td className={`num${isOverdue ? ' cell-emphasis' : ''}`}>
                    {currency.format(Number(row.outstanding))}
                  </td>
                  <td>
                    {canRecordPayment ? (
                      <button type="button" className="button button--ghost" onClick={() => onRecordPayment(row)}>
                        Tahsilat gir
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function badgeClass(bucket: ReceivableRow['risk_bucket']): string {
  switch (bucket) {
    case 'overdue': return 'critical';
    case 'due_today': return 'urgent';
    case 'due_soon': return 'warning';
    case 'paid': return 'ok';
    default: return 'upcoming';
  }
}
