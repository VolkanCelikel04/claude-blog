import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { StatTile } from '../../components/charts/StatTile';
import { currency } from '../../components/charts/chart-theme';

interface PlatformInvoice {
  id: string;
  invoice_no: string;
  tenant_name: string;
  issue_date: string;
  due_date: string;
  total: string;
  paid_amount: string;
  status: string;
  days_to_due: number;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Taslak', sent: 'Gönderildi', partially_paid: 'Kısmi ödendi',
  paid: 'Ödendi', overdue: 'Gecikti', void: 'İptal',
};

export default function BillingPage() {
  const invoices = useQuery({
    queryKey: ['admin', 'invoices'],
    queryFn: () => api<PlatformInvoice[]>('/admin/invoices'),
  });

  const revenue = useQuery({
    queryKey: ['admin', 'revenue'],
    queryFn: () => api<{ totals: Record<string, number> }>('/admin/revenue'),
  });

  const totals = revenue.data?.totals;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Ödeme Takibi</h1>
          <p className="page-subtitle">Tenant bazlı faturalar ve tahsilat durumu</p>
        </div>
      </header>

      <div className="grid grid--kpi" style={{ marginBottom: 20 }}>
        <StatTile label="Tahsil edilen" value={totals ? currency.format(totals.collected_total) : '-'} />
        <StatTile label="Açık fatura" value={totals ? currency.format(totals.open_total) : '-'} />
        <StatTile
          label="Geciken"
          value={totals ? currency.format(totals.overdue_total) : '-'}
          hint={totals ? `${totals.overdue_count} fatura` : undefined}
          tone={(totals?.overdue_total ?? 0) > 0 ? 'critical' : 'neutral'}
        />
      </div>

      <section className="card">
        {invoices.isLoading ? (
          <p className="empty">Yükleniyor...</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Fatura</th><th>Şirket</th><th>Vade</th><th>Durum</th>
                  <th className="num">Tutar</th><th className="num">Ödenen</th>
                </tr>
              </thead>
              <tbody>
                {(invoices.data ?? []).map((invoice) => {
                  const overdue = invoice.status === 'overdue';
                  return (
                    <tr key={invoice.id} className={overdue ? 'row--overdue' : undefined}>
                      <td className="mono">{invoice.invoice_no}</td>
                      <td>{invoice.tenant_name}</td>
                      <td className="mono">{new Date(invoice.due_date).toLocaleDateString('tr-TR')}</td>
                      <td>
                        <span className={`badge badge--${overdue ? 'critical' : invoice.status === 'paid' ? 'ok' : 'upcoming'}`}>
                          {STATUS_LABELS[invoice.status] ?? invoice.status}
                          {overdue ? <span className="mono"> · {Math.abs(invoice.days_to_due)} gün</span> : null}
                        </span>
                      </td>
                      <td className="num">{currency.format(Number(invoice.total))}</td>
                      <td className="num">{currency.format(Number(invoice.paid_amount))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
