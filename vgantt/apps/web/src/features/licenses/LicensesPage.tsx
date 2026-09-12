import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import { useAuth } from '../../lib/auth-store';
import { currency } from '../../components/charts/chart-theme';
import { StatTile } from '../../components/charts/StatTile';
import { ExpiryBadge } from './ExpiryBadge';
import { LicenseForm } from './LicenseForm';
import type { LicenseRow } from '../../lib/types';

const BUCKET_FILTERS = [
  { value: '', label: 'Tümü' },
  { value: 'expired', label: 'Süresi dolmuş' },
  { value: 'critical', label: '3 gün' },
  { value: 'urgent', label: '7 gün' },
  { value: 'warning', label: '15 gün' },
  { value: 'upcoming', label: '30 gün' },
] as const;

/** MODULE A - lisans, domain, SSL ve abonelik süre takibi. */
export default function LicensesPage() {
  const can = useAuth((state) => state.can);
  const queryClient = useQueryClient();

  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);

  const list = useQuery({
    queryKey: ['licenses', { bucket, search }],
    queryFn: () =>
      api<{ items: LicenseRow[]; total: number }>('/licenses', {
        query: { bucket: bucket || undefined, search: search || undefined, limit: 100 },
      }),
  });

  const summary = useQuery({
    queryKey: ['licenses', 'summary'],
    queryFn: () => api<{ buckets: Record<string, number>; costByBucket: Record<string, number> }>('/licenses/summary'),
  });

  const renew = useMutation({
    mutationFn: ({ id, newEndDate }: { id: string; newEndDate: string }) =>
      api(`/licenses/${id}/renew`, { method: 'POST', body: { newEndDate } }),
    onSuccess: () => {
      // Renewing changes the due date, which restarts the warning ladder.
      void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const buckets = summary.data?.buckets ?? {};

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Lisans ve Süre Takibi</h1>
          <p className="page-subtitle">
            Yazılım, domain, SSL ve abonelik bitiş tarihleri. Uyarılar 30, 15, 7 ve 3 gün kala üretilir.
          </p>
        </div>
        {can('licenses.write') ? (
          <button type="button" className="button button--primary" onClick={() => setFormOpen(true)}>
            Yeni kayıt
          </button>
        ) : null}
      </header>

      <div className="grid grid--kpi" style={{ marginBottom: 18 }}>
        <StatTile label="Süresi dolmuş" value={String(buckets.expired ?? 0)} tone={(buckets.expired ?? 0) > 0 ? 'critical' : 'neutral'} />
        <StatTile label="3 gün içinde" value={String(buckets.critical ?? 0)} tone={(buckets.critical ?? 0) > 0 ? 'critical' : 'neutral'} />
        <StatTile label="7 gün içinde" value={String(buckets.urgent ?? 0)} tone={(buckets.urgent ?? 0) > 0 ? 'warning' : 'neutral'} />
        <StatTile label="30 gün içinde" value={String(buckets.upcoming ?? 0)} />
      </div>

      <div className="toolbar">
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Kayıt veya tedarikçi ara"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select className="select" style={{ maxWidth: 180 }} value={bucket} onChange={(event) => setBucket(event.target.value)}>
          {BUCKET_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="muted">{list.data?.total ?? 0} kayıt</span>
      </div>

      <section className="card">
        {list.isLoading ? (
          <p className="empty">Yükleniyor...</p>
        ) : list.data?.items.length ? (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Kayıt</th>
                  <th>Tür</th>
                  <th>Tedarikçi</th>
                  <th>Bitiş tarihi</th>
                  <th>Durum</th>
                  <th className="num">Tutar</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((row) => (
                  <tr key={row.id} className={row.expiry_bucket === 'expired' ? 'row--overdue' : undefined}>
                    <td><strong>{row.name}</strong></td>
                    <td className="muted">{row.license_type}</td>
                    <td>{row.vendor ?? '-'}</td>
                    <td className="mono">{new Date(row.end_date).toLocaleDateString('tr-TR')}</td>
                    <td><ExpiryBadge bucket={row.expiry_bucket} days={row.days_remaining} /></td>
                    <td className="num">{row.cost ? currency.format(Number(row.cost)) : '-'}</td>
                    <td>
                      {can('licenses.renew') ? (
                        <button
                          type="button"
                          className="button button--ghost"
                          disabled={renew.isPending}
                          onClick={() => renew.mutate({ id: row.id, newEndDate: plusOneYear(row.end_date) })}
                        >
                          1 yıl uzat
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty">Kayıt bulunamadı.</p>
        )}
      </section>

      {formOpen ? <LicenseForm onClose={() => setFormOpen(false)} /> : null}
    </>
  );
}

function plusOneYear(isoDate: string): string {
  const date = new Date(isoDate);
  date.setFullYear(date.getFullYear() + 1);
  return date.toISOString().slice(0, 10);
}
