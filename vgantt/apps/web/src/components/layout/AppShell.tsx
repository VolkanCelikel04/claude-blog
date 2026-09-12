import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../lib/auth-store';
import { api } from '../../lib/api-client';
import { visibleModules, isDesktop } from '../../modules/module-registry';
import { SubscriptionBanner } from './SubscriptionBanner';
import { NotificationBell } from './NotificationBell';
import type { Notification } from '../../lib/types';

/**
 * The sidebar is rendered from the module registry filtered by the session.
 *
 * A module VganttAdmin has switched off is simply absent from
 * session.enabledModules, so it disappears here without any special case - the
 * same fact that makes the API return 402 and the RLS policy hide the rows.
 */
export function AppShell() {
  const session = useAuth((state) => state.session);
  const logout = useAuth((state) => state.logout);

  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: Notification[]; unread: number; critical: number }>('/notifications'),
    refetchInterval: 60_000,
    enabled: Boolean(session),
  });

  if (!session) return null;

  const modules = visibleModules({
    permissions: session.permissions,
    enabledModules: session.enabledModules,
  });

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Ana menü">
        <div className="sidebar__brand">
          Vgantt
          <span className="sidebar__tenant">{session.tenantName}</span>
        </div>

        {modules.map((module) => {
          const route = module.routes[0];
          const unavailableOnWeb = module.desktopOnly && !isDesktop();

          return (
            <NavLink
              key={module.key}
              to={route.path}
              end={route.path === '/'}
              className="nav-item"
              title={unavailableOnWeb ? 'Bu modül yalnızca masaüstü uygulamasında çalışır' : undefined}
            >
              {module.label}
              {unavailableOnWeb ? <span className="muted" style={{ marginLeft: 'auto', fontSize: 11 }}>masaüstü</span> : null}
              {module.key === 'dashboard' && notifications.data?.critical ? (
                <span className="nav-item__badge">{notifications.data.critical}</span>
              ) : null}
            </NavLink>
          );
        })}

        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, padding: '0 10px 8px' }}>
            {session.fullName}
          </div>
          <button type="button" className="button button--ghost" onClick={() => void logout()}>
            Çıkış yap
          </button>
        </div>
      </nav>

      <main className="main">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <NotificationBell
            items={notifications.data?.items ?? []}
            unread={notifications.data?.unread ?? 0}
          />
        </div>

        <SubscriptionBanner subscription={session.subscription} />
        <Outlet />
      </main>
    </div>
  );
}
