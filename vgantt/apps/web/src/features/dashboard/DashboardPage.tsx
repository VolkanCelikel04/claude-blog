import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-store';
import { StatTile } from '../../components/charts/StatTile';
import { currency } from '../../components/charts/chart-theme';
import { ExpiryBadge } from '../licenses/ExpiryBadge';
import type { FinanceOverview, LicenseRow } from '../../lib/types';

/**
 * The landing page answers one question: what needs attention today.
 *
 * It only queries the modules the tenant actually licenses, so a disabled
 * module produces no request and therefore no 402 to swallow.
 */
export default function DashboardPage() {
  const session = useAuth((state) => state.session)!;
  const hasLicenses = session.enabledModules.includes('licenses');
  const hasFinance = session.enabledModules.includes('finance');

  const licenses = useQuery({
    queryKey: ['licenses', 'summary'],
    queryFn: () => api<{ buckets: Record<string, number>; upcoming: LicenseRow[] }>('/licenses/summary'),
    enabled: hasLicenses,
  });

  const finance = useQuery({
    queryKey: ['finance', 'dashboard'],
    queryFn: () => api<FinanceOverview>('/finance/dashboard'),
    enabled: hasFinance,
  });

  const buckets = licenses.data?.buckets ?? {};
  const expiringSoon = (buckets.critical ?? 0) + (buckets.urgent ?? 0);

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Merhaba, {session.fullName.split(' ')[0]}</h1>
          <p className="page-subtitle">{session.tenantName} - bugünkü durum</p>
        </div>
      </header>

      <div className="grid grid--kpi" style={{ marginBottom: 20 }}>
        {hasLicenses ? (
          <>
            <StatTile
              label="Süresi dolmuş"
              value={String(buckets.expired ?? 0)}
              hint="Lisans / domain / SSL"
              tone={(buckets.expired ?? 0) > 0 ? 'critical' : 'neutral'}
            />
            <StatTile
              label="7 gün içinde bitiyor"
              value={String(expiringSoon)}
              hint="Acil yenileme gerekiyor"
              tone={expiringSoon > 0 ? 'warning' : 'neutral'}
            />
          </>
        ) : null}

        {hasFinance && finance.data ? (
          <>
            <StatTile
              label="Geciken alacak"
              value={currency.format(finance.data.totals.overdueReceivables)}
              hint="Vadesi geçmiş faturalar"
              tone={finance.data.totals.overdueReceivables > 0 ? 'critical' : 'neutral'}
            />
            <StatTile
              label="3 gün içinde vadesi gelen"
              value={currency.format(finance.data.totals.dueWithin3Days)}
              hint="Hatırlatma gönderildi"
            />
          </>
        ) : null}
      </div>

      {hasLicenses ? (
        <section className="card" style={{ marginBottom: 16 }}>
          <header className="card__head">
            <h2 className="card__title">Süresi yaklaşan kayıtlar</h2>
            <Link to="/licenses" className="button button--ghost">Tümünü gör</Link>
          </header>

          {licenses.isLoading ? (
            <p className="empty">Yükleniyor...</p>
          ) : licenses.data?.upcoming.length ? (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Kayıt</th>
                    <th>Tür</th>
                    <th>Bitiş</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {licenses.data.upcoming.map((row) => (
                    <tr key={row.id} className={row.expiry_bucket === 'expired' ? 'row--overdue' : undefined}>
                      <td>{row.name}</td>
                      <td className="muted">{row.license_type}</td>
                      <td className="mono">{new Date(row.end_date).toLocaleDateString('tr-TR')}</td>
                      <td><ExpiryBadge bucket={row.expiry_bucket} days={row.days_remaining} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">Önümüzdeki 30 gün içinde biten bir kayıt yok.</p>
          )}
        </section>
      ) : null}

      {hasFinance && finance.data ? (
        <section className="card">
          <header className="card__head">
            <h2 className="card__title">En yüksek açık bakiyeler</h2>
            <Link to="/finance" className="button button--ghost">Finans modülü</Link>
          </header>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Müşteri</th>
                  <th className="num">Açık bakiye</th>
                  <th className="num">Geciken fatura</th>
                </tr>
              </thead>
              <tbody>
                {finance.data.topDebtors.map((debtor) => (
                  <tr key={debtor.customerName} className={debtor.overdueCount > 0 ? 'row--overdue' : undefined}>
                    <td>{debtor.customerName}</td>
                    <td className="num">{currency.format(debtor.outstanding)}</td>
                    <td className="num cell-emphasis">{debtor.overdueCount || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
