import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../lib/auth-store';

export function AdminShell() {
  const admin = useAuth((state) => state.adminSession);
  const logout = useAuth((state) => state.logout);

  if (!admin) return null;

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="VganttAdmin menüsü">
        <div className="sidebar__brand">
          VganttAdmin
          <span className="sidebar__tenant">{admin.fullName} · {admin.role}</span>
        </div>

        <NavLink to="/admin" end className="nav-item">Genel Bakış</NavLink>
        <NavLink to="/admin/tenants" className="nav-item">Şirketler</NavLink>
        <NavLink to="/admin/modules" className="nav-item">Modül Lisansları</NavLink>
        <NavLink to="/admin/billing" className="nav-item">Ödeme Takibi</NavLink>

        <div style={{ marginTop: 'auto' }}>
          <button type="button" className="button button--ghost" onClick={() => void logout()}>Çıkış yap</button>
        </div>
      </nav>

      <main className="main"><Outlet /></main>
    </div>
  );
}
