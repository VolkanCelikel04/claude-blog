import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api-client';
import { StatTile } from '../../components/charts/StatTile';
import { currency } from '../../components/charts/chart-theme';
import { ExpiryBadge } from '../licenses/ExpiryBadge';
import type { TenantOverviewRow } from '../../lib/types';

interface AdminDashboard {
  counts: Record<string, number>;
  revenue: Array<{ month: string; collected: number; payingTenants: number }>;
  expiringTenants: TenantOverviewRow[];
  alerts: Array<{
    id: string; severity: string; category: string; title: string;
    body: string | null; due_date: string | null; threshold_days: number | null;
  }>;
}

export default function AdminDashboardPage() {
  const dashboard = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => api<AdminDashboard>('/admin/dashboard'),
  });

  if (dashboard.isLoading) return <p className="empty">Yükleniyor...</p>;
  const data = dashboard.data;
  if (!data) return null;

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Genel Bakış</h1>
          <p className="page-subtitle">Tüm kiracıların abonelik, modül ve ödeme durumu</p>
        </div>
      </header>

      <div className="grid grid--kpi" style={{ marginBottom: 20 }}>
        <StatTile label="Aktif şirket" value={String(data.counts.active_tenants ?? 0)} />
        <StatTile label="Deneme sürümü" value={String(data.counts.trial_tenants ?? 0)} />
        <StatTile
          label="7 gün içinde bitiyor"
          value={String(data.counts.expiring_soon ?? 0)}
          tone={(data.counts.expiring_soon ?? 0) > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Süresi dolmuş"
          value={String(data.counts.expired ?? 0)}
          tone={(data.counts.expired ?? 0) > 0 ? 'critical' : 'neutral'}
        />
        <StatTile
          label="Geciken tahsilat"
          value={currency.format(data.counts.overdue_balance ?? 0)}
          tone={(data.counts.overdue_balance ?? 0) > 0 ? 'critical' : 'neutral'}
        />
      </div>

      <div className="grid grid--halves">
        <section className="card">
          <header className="card__head">
            <h2 className="card__title">Süresi yaklaşan abonelikler</h2>
            <Link className="button button--ghost" to="/admin/tenants?expiringWithin=30">Tümü</Link>
          </header>

          {data.expiringTenants.length === 0 ? (
            <p className="empty">Önümüzdeki 30 gün içinde biten abonelik yok.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr><th>Şirket</th><th>Plan</th><th>Bitiş</th><th>Durum</th></tr>
                </thead>
                <tbody>
                  {data.expiringTenants.map((tenant) => (
                    <tr key={tenant.tenant_id} className={tenant.expiry_bucket === 'expired' ? 'row--overdue' : undefined}>
                      <td><Link to={`/admin/tenants/${tenant.tenant_id}`}>{tenant.name}</Link></td>
                      <td className="muted">{tenant.plan_name ?? '-'}</td>
                      <td className="mono">{tenant.ends_on ? new Date(tenant.ends_on).toLocaleDateString('tr-TR') : '-'}</td>
                      <td>
                        {tenant.days_remaining !== null ? (
                          <ExpiryBadge
                            bucket={tenant.expiry_bucket === 'none' ? 'inactive' : tenant.expiry_bucket}
                            days={tenant.days_remaining}
                          />
                        ) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <header className="card__head">
            <h2 className="card__title">Okunmamış sistem uyarıları</h2>
            <span className="card__note">30 / 15 / 7 / 3 gün merdiveni</span>
          </header>

          {data.alerts.length === 0 ? (
            <p className="empty">Bekleyen uyarı yok.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10, maxHeight: 380, overflowY: 'auto' }}>
              {data.alerts.map((alert) => (
                <li key={alert.id}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span className={`badge badge--${alert.severity === 'critical' ? 'critical' : alert.severity === 'warning' ? 'warning' : 'upcoming'}`}>
                      {alert.threshold_days !== null && alert.threshold_days < 0
                        ? `${Math.abs(alert.threshold_days)} gün gecikti`
                        : `${alert.threshold_days ?? 0} gün`}
                    </span>
                    <strong style={{ fontSize: 13 }}>{alert.title}</strong>
                  </div>
                  {alert.body ? <div className="muted" style={{ fontSize: 12.5 }}>{alert.body}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
