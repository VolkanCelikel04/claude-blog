import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api-client';
import { currency } from '../../components/charts/chart-theme';
import { ExpiryBadge } from '../licenses/ExpiryBadge';
import type { TenantOverviewRow } from '../../lib/types';

const STATUS_LABELS: Record<string, string> = {
  trial: 'Deneme', active: 'Aktif', suspended: 'Pasif', cancelled: 'İptal',
};

export default function TenantsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const tenants = useQuery({
    queryKey: ['admin', 'tenants', { search, status }],
    queryFn: () =>
      api<TenantOverviewRow[]>('/admin/tenants', {
        query: { search: search || undefined, status: status || undefined },
      }),
  });

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Şirketler</h1>
          <p className="page-subtitle">Abonelik durumu, modül sayısı ve açık bakiye</p>
        </div>
      </header>

      <div className="toolbar">
        <input className="input" style={{ maxWidth: 260 }} placeholder="Şirket adı veya kodu"
               value={search} onChange={(event) => setSearch(event.target.value)} />
        <select className="select" style={{ maxWidth: 180 }} value={status}
                onChange={(event) => setStatus(event.target.value)}>
          <option value="">Tüm durumlar</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <section className="card">
        {tenants.isLoading ? (
          <p className="empty">Yükleniyor...</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Şirket</th><th>Durum</th><th>Plan</th><th>Abonelik bitişi</th>
                  <th className="num">Kullanıcı</th><th className="num">Modül</th>
                  <th className="num">Açık bakiye</th>
                </tr>
              </thead>
              <tbody>
                {(tenants.data ?? []).map((tenant) => (
                  <tr key={tenant.tenant_id} className={Number(tenant.overdue_balance) > 0 ? 'row--overdue' : undefined}>
                    <td>
                      <Link to={`/admin/tenants/${tenant.tenant_id}`}><strong>{tenant.name}</strong></Link>
                      <div className="muted mono">{tenant.slug}</div>
                    </td>
                    <td>
                      <span className={`badge badge--${tenant.tenant_status === 'active' ? 'ok' : tenant.tenant_status === 'suspended' ? 'critical' : 'upcoming'}`}>
                        {STATUS_LABELS[tenant.tenant_status] ?? tenant.tenant_status}
                      </span>
                    </td>
                    <td className="muted">{tenant.plan_name ?? '-'}</td>
                    <td>
                      {tenant.days_remaining !== null && tenant.expiry_bucket !== 'none' ? (
                        <ExpiryBadge bucket={tenant.expiry_bucket} days={tenant.days_remaining} />
                      ) : <span className="muted">Abonelik yok</span>}
                    </td>
                    <td className="num">{tenant.active_users}</td>
                    <td className="num">{tenant.enabled_modules}</td>
                    <td className={`num${Number(tenant.overdue_balance) > 0 ? ' cell-emphasis' : ''}`}>
                      {currency.format(Number(tenant.open_balance))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
