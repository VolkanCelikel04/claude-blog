import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth-store';

export default function LoginPage() {
  const login = useAuth((state) => state.login);
  const loginAdmin = useAuth((state) => state.loginAdmin);
  const error = useAuth((state) => state.error);
  const navigate = useNavigate();

  const [mode, setMode] = useState<'tenant' | 'admin'>('tenant');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [tenantSlug, setTenantSlug] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === 'admin') {
        await loginAdmin(email, password);
        navigate('/admin');
      } else {
        await login(email, password, tenantSlug || undefined);
        navigate('/');
      }
    } catch {
      // The store already holds a readable message.
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="card auth-card" onSubmit={handleSubmit}>
        <h1 className="page-title" style={{ marginBottom: 4 }}>Vgantt Suite</h1>
        <p className="page-subtitle" style={{ marginBottom: 20 }}>
          {mode === 'admin' ? 'Sistem yöneticisi girişi' : 'Şirket hesabınızla giriş yapın'}
        </p>

        {error ? (
          <div className="banner banner--critical" role="alert">
            <strong aria-hidden="true">!</strong>
            <div>{error}</div>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="email">E-posta</label>
          <input
            id="email" className="input" type="email" autoComplete="username" required
            value={email} onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="password">Şifre</label>
          <input
            id="password" className="input" type="password" autoComplete="current-password" required
            value={password} onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        {mode === 'tenant' ? (
          <div className="field">
            <label htmlFor="tenant">Şirket kodu <span className="muted">(yalnızca gerekirse)</span></label>
            <input
              id="tenant" className="input" type="text" placeholder="acme-insaat"
              value={tenantSlug} onChange={(event) => setTenantSlug(event.target.value)}
            />
          </div>
        ) : null}

        <button type="submit" className="button button--primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'Giriş yapılıyor...' : 'Giriş yap'}
        </button>

        <button
          type="button"
          className="button button--ghost"
          style={{ width: '100%', marginTop: 8 }}
          onClick={() => setMode(mode === 'tenant' ? 'admin' : 'tenant')}
        >
          {mode === 'tenant' ? 'VganttAdmin girişi' : 'Şirket girişine dön'}
        </button>
      </form>
    </div>
  );
}
