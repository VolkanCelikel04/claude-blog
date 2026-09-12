import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuth } from './lib/auth-store';
import { ApiError } from './lib/api-client';
import { AppShell } from './components/layout/AppShell';
import { AdminShell } from './features/admin/AdminShell';
import LoginPage from './features/auth/LoginPage';

const DashboardPage = lazy(() => import('./features/dashboard/DashboardPage'));
const LicensesPage = lazy(() => import('./features/licenses/LicensesPage'));
const FinancePage = lazy(() => import('./features/finance/FinancePage'));
const VaultPage = lazy(() => import('./features/vault/VaultPage'));
const AdminDashboardPage = lazy(() => import('./features/admin/AdminDashboardPage'));
const TenantsPage = lazy(() => import('./features/admin/TenantsPage'));
const ModuleLicensingPage = lazy(() => import('./features/admin/ModuleLicensingPage'));
const BillingPage = lazy(() => import('./features/admin/BillingPage'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failureCount, error) => {
        // A missing module licence or a permission failure will not fix itself.
        if (error instanceof ApiError && [401, 402, 403].includes(error.status)) return false;
        return failureCount < 2;
      },
    },
  },
});

export default function App() {
  const status = useAuth((state) => state.status);
  const session = useAuth((state) => state.session);
  const adminSession = useAuth((state) => state.adminSession);
  const restore = useAuth((state) => state.restore);

  useEffect(() => {
    void restore();
  }, [restore]);

  if (status !== 'ready') {
    return <div className="auth-page"><p className="muted">Yükleniyor...</p></div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="main"><p className="empty">Yükleniyor...</p></div>}>
          <Routes>
            <Route
              path="/login"
              element={session ? <Navigate to="/" replace /> : adminSession ? <Navigate to="/admin" replace /> : <LoginPage />}
            />

            {/* VganttAdmin control plane - a tenant token cannot reach these. */}
            <Route path="/admin" element={adminSession ? <AdminShell /> : <Navigate to="/login" replace />}>
              <Route index element={<AdminDashboardPage />} />
              <Route path="tenants" element={<TenantsPage />} />
              <Route path="modules" element={<ModuleLicensingPage />} />
              <Route path="billing" element={<BillingPage />} />
            </Route>

            {/* Tenant workspace. Module routes are mounted unconditionally and
                guarded inside, so a deep link to a disabled module explains
                itself rather than 404ing. */}
            <Route path="/" element={session ? <AppShell /> : <Navigate to="/login" replace />}>
              <Route index element={<DashboardPage />} />
              <Route path="licenses" element={<ModuleRoute moduleKey="licenses"><LicensesPage /></ModuleRoute>} />
              <Route path="finance" element={<ModuleRoute moduleKey="finance"><FinancePage /></ModuleRoute>} />
              <Route path="vault" element={<ModuleRoute moduleKey="vault"><VaultPage /></ModuleRoute>} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

/** Explains a disabled module instead of pretending the page does not exist. */
function ModuleRoute({ moduleKey, children }: { moduleKey: string; children: ReactNode }) {
  const hasModule = useAuth((state) => state.hasModule(moduleKey));
  if (hasModule) return <>{children}</>;

  return (
    <div className="banner banner--info">
      <strong aria-hidden="true">i</strong>
      <div>
        <strong>Bu modül şirketiniz için etkin değil.</strong>
        <p className="muted" style={{ margin: '4px 0 0' }}>
          Modülü açtırmak için şirket yöneticinizle veya Vgantt ile iletişime geçin.
        </p>
      </div>
    </div>
  );
}
