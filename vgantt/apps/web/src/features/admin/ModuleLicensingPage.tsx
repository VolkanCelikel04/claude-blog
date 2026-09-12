import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api-client';
import type { ModuleMatrixRow } from '../../lib/types';

interface ModuleCatalogueRow {
  key: string;
  name: string;
  description: string | null;
  is_core: boolean;
  requires_desktop: boolean;
  stores_server_data: boolean;
  active_tenants: number;
}

/**
 * The one-click module licensing grid.
 *
 * Flipping a switch calls PUT /admin/tenants/:id/modules/:key. On the server
 * that single write simultaneously removes the module from the tenant's menu,
 * makes its API routes answer 402, and hides its rows at the RLS layer. No data
 * is deleted, so switching back restores everything.
 */
export default function ModuleLicensingPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const catalogue = useQuery({
    queryKey: ['admin', 'modules'],
    queryFn: () => api<ModuleCatalogueRow[]>('/admin/modules'),
  });

  const matrix = useQuery({
    queryKey: ['admin', 'modules', 'matrix'],
    queryFn: () => api<ModuleMatrixRow[]>('/admin/modules/matrix'),
  });

  const toggle = useMutation({
    mutationFn: ({ tenantId, moduleKey, enabled }: { tenantId: string; moduleKey: string; enabled: boolean }) =>
      api(`/admin/tenants/${tenantId}/modules/${moduleKey}`, { method: 'PUT', body: { enabled } }),
    onMutate: () => setError(null),
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : 'Modül durumu değiştirilemedi.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const byTenant = useMemo(() => {
    const rows = matrix.data ?? [];
    const grouped = new Map<string, { tenantName: string; modules: ModuleMatrixRow[] }>();

    for (const row of rows) {
      if (filter && !row.tenant_name.toLocaleLowerCase('tr').includes(filter.toLocaleLowerCase('tr'))) continue;
      const bucket = grouped.get(row.tenant_id) ?? { tenantName: row.tenant_name, modules: [] };
      bucket.modules.push(row);
      grouped.set(row.tenant_id, bucket);
    }
    return grouped;
  }, [matrix.data, filter]);

  const moduleKeys = catalogue.data ?? [];

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Modül Lisansları</h1>
          <p className="page-subtitle">
            Bir modülü kapattığınızda tenant o menüye ve API'ye erişemez; veriler silinmez, yeniden
            açtığınızda geri gelir.
          </p>
        </div>
      </header>

      {error ? <div className="banner banner--critical" role="alert">{error}</div> : null}

      <section className="card" style={{ marginBottom: 16 }}>
        <header className="card__head"><h2 className="card__title">Modül kataloğu</h2></header>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Modül</th><th>Açıklama</th><th>Özellikler</th><th className="num">Aktif şirket</th>
              </tr>
            </thead>
            <tbody>
              {moduleKeys.map((module) => (
                <tr key={module.key}>
                  <td><strong>{module.name}</strong><div className="muted mono">{module.key}</div></td>
                  <td className="muted">{module.description}</td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {module.is_core ? <span className="badge badge--ok">Çekirdek</span> : null}
                    {module.requires_desktop ? <span className="badge badge--upcoming">Masaüstü gerekir</span> : null}
                    {!module.stores_server_data ? (
                      <span className="badge badge--warning" title="Bu modülün verileri sunucuda saklanmaz">
                        Sunucuda veri tutmaz
                      </span>
                    ) : null}
                  </td>
                  <td className="num">{module.active_tenants}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="toolbar">
        <input
          className="input" style={{ maxWidth: 280 }} placeholder="Şirket ara"
          value={filter} onChange={(event) => setFilter(event.target.value)}
        />
      </div>

      <section className="card">
        <header className="card__head">
          <h2 className="card__title">Şirket × modül ızgarası</h2>
          <span className="card__note">Değişiklik anında geçerli olur</span>
        </header>

        {matrix.isLoading ? (
          <p className="empty">Yükleniyor...</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Şirket</th>
                  {moduleKeys.map((module) => <th key={module.key}>{module.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {[...byTenant.entries()].map(([tenantId, bucket]) => (
                  <tr key={tenantId}>
                    <td><strong>{bucket.tenantName}</strong></td>
                    {moduleKeys.map((module) => {
                      const row = bucket.modules.find((m) => m.module_key === module.key);
                      const enabled = row?.is_enabled ?? false;
                      const pending =
                        toggle.isPending &&
                        toggle.variables?.tenantId === tenantId &&
                        toggle.variables?.moduleKey === module.key;

                      return (
                        <td key={module.key}>
                          <label className="switch">
                            <input
                              type="checkbox"
                              checked={enabled}
                              disabled={module.is_core || pending}
                              aria-label={`${bucket.tenantName} için ${module.name}`}
                              onChange={(event) =>
                                toggle.mutate({ tenantId, moduleKey: module.key, enabled: event.target.checked })
                              }
                            />
                            <span className="switch__track" />
                            <span className="switch__thumb" />
                            <span className="muted" style={{ fontSize: 12 }}>
                              {enabled ? 'Açık' : 'Kapalı'}
                            </span>
                          </label>
                          {row?.valid_until ? (
                            <div className="muted" style={{ fontSize: 11.5 }}>
                              bitiş {new Date(row.valid_until).toLocaleDateString('tr-TR')}
                              {row.module_days_remaining !== null && row.module_days_remaining <= 30
                                ? ` · ${row.module_days_remaining} gün`
                                : ''}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
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
