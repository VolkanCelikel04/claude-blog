import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api-client';
import { vaultBridge, type VaultEntrySummary, type VaultStatus } from './vault-bridge';
import { VaultEntryForm } from './VaultEntryForm';

/**
 * MODULE C - Yerel Şifre Kasası
 *
 * Bu ekranda görünen hiçbir veri sunucudan gelmez ve sunucuya gitmez. Kayıtlar
 * kullanıcının kendi makinesindeki C:/Rsdw/vault.xlsx dosyasından okunur.
 *
 * The single call to the API on this page sends a device label, the file path
 * and the entry COUNT, so support can answer "where is my vault" - nothing else
 * is transmitted, and the API would reject it if it were.
 */
export default function VaultPage() {
  const bridge = vaultBridge();

  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [entries, setEntries] = useState<VaultEntrySummary[]>([]);
  const [masterPassword, setMasterPassword] = useState('');
  const [query, setQuery] = useState('');
  const [revealed, setRevealed] = useState<{ id: string; value: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    const next = await bridge.list();
    setEntries(next);
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    void bridge.status().then(setStatus);
  }, [bridge]);

  if (!bridge) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Yerel Şifre Kasası</h1>
          </div>
        </header>
        <div className="banner banner--info">
          <strong aria-hidden="true">i</strong>
          <div>
            <strong>Bu modül yalnızca Vgantt masaüstü uygulamasında çalışır.</strong>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              Kasa verileri tarayıcıya değil, bilgisayarınızdaki <code>C:/Rsdw</code> klasörüne yazılır.
              Bunun için dosya sistemine erişebilen masaüstü uygulaması gerekir.
            </p>
          </div>
        </div>
      </>
    );
  }

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const next = await bridge!.unlock(masterPassword);
      setStatus(next);
      setMasterPassword('');
      await refresh();

      // The only server call this module ever makes: label + path + count.
      const metadata = await bridge!.metadataForServer();
      await api('/vault/workstations', { method: 'PUT', body: metadata }).catch(() => undefined);
    } catch (unlockError) {
      setError((unlockError as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    await bridge!.lock();
    setStatus((current) => (current ? { ...current, unlocked: false } : current));
    setEntries([]);
    setRevealed(null);
  }

  async function runSearch(value: string) {
    setQuery(value);
    setEntries(value ? await bridge!.search(value) : await bridge!.list());
  }

  if (!status?.unlocked) {
    return (
      <>
        <header className="page-header">
          <div>
            <h1 className="page-title">Yerel Şifre Kasası</h1>
            <p className="page-subtitle">
              Kayıtlar yalnızca bu bilgisayarda, <code>{status?.path ?? 'C:/Rsdw/vault.xlsx'}</code> dosyasında saklanır.
            </p>
          </div>
        </header>

        <section className="card" style={{ maxWidth: 460 }}>
          <h2 className="card__title" style={{ marginBottom: 12 }}>
            {status?.exists ? 'Kasayı aç' : 'Kasayı oluştur'}
          </h2>

          {!status?.exists ? (
            <div className="banner banner--info">
              <strong aria-hidden="true">i</strong>
              <div>
                Kasa dosyası bulunamadı. Girdiğiniz ana şifre ile <code>{status?.directory}</code> klasörü
                ve yeni bir şifreli Excel dosyası oluşturulacak.
              </div>
            </div>
          ) : null}

          {error ? <div className="banner banner--critical" role="alert">{error}</div> : null}

          <div className="field">
            <label htmlFor="master">Ana şifre</label>
            <input
              id="master" className="input" type="password" autoComplete="current-password"
              value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void unlock(); }}
            />
          </div>

          <button type="button" className="button button--primary" disabled={busy || masterPassword.length < 8}
                  onClick={() => void unlock()} style={{ width: '100%' }}>
            {busy ? 'Açılıyor...' : status?.exists ? 'Kasayı aç' : 'Kasayı oluştur'}
          </button>

          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Ana şifre hiçbir yere kaydedilmez ve sunucuya gönderilmez. Unutulması halinde kasa içeriği
            kurtarılamaz.
          </p>
        </section>
      </>
    );
  }

  return (
    <>
      <header className="page-header">
        <div>
          <h1 className="page-title">Yerel Şifre Kasası</h1>
          <p className="page-subtitle">
            {status.entryCount} kayıt · <code>{status.path}</code> ·{' '}
            {status.encryption === 'aes-256-gcm' ? 'AES-256-GCM ile şifreli' : 'şifresiz (önerilmez)'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="button" onClick={() => void bridge.backup()}>Yedekle</button>
          <button type="button" className="button" onClick={() => void lock()}>Kilitle</button>
          <button type="button" className="button button--primary" onClick={() => setFormOpen(true)}>Yeni kayıt</button>
        </div>
      </header>

      <div className="banner banner--info">
        <strong aria-hidden="true">i</strong>
        <div>
          Bu sayfadaki veriler sunucuya <strong>gönderilmez</strong>. Yalnızca makine adı, dosya yolu ve
          kayıt sayısı, destek amacıyla Vgantt'a bildirilir.
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input" style={{ maxWidth: 300 }} placeholder="Başlık, kullanıcı adı veya etiket ara"
          value={query} onChange={(event) => void runSearch(event.target.value)}
        />
      </div>

      <section className="card">
        {entries.length === 0 ? (
          <p className="empty">Kayıt yok.</p>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Başlık</th>
                  <th>Kategori</th>
                  <th>Kullanıcı adı</th>
                  <th>Şifre</th>
                  <th>Güncelleme</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entry.title}</strong>
                      {entry.url ? <div className="muted">{entry.url}</div> : null}
                    </td>
                    <td>{entry.category || '-'}</td>
                    <td className="mono">{entry.username || '-'}</td>
                    <td className="mono">
                      {revealed?.id === entry.id ? revealed.value : '••••••••••'}
                    </td>
                    <td className="mono">{new Date(entry.updatedAt).toLocaleDateString('tr-TR')}</td>
                    <td style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button" className="button button--ghost"
                        onClick={async () => {
                          if (revealed?.id === entry.id) { setRevealed(null); return; }
                          setRevealed({ id: entry.id, value: await bridge.reveal(entry.id) });
                        }}
                      >
                        {revealed?.id === entry.id ? 'Gizle' : 'Göster'}
                      </button>
                      <button
                        type="button" className="button button--ghost"
                        title="Şifre ana süreçte panoya kopyalanır, 30 saniye sonra temizlenir"
                        onClick={() => void bridge.copyPassword(entry.id)}
                      >
                        Kopyala
                      </button>
                      <button
                        type="button" className="button button--ghost"
                        onClick={async () => {
                          if (!window.confirm(`"${entry.title}" kaydı silinsin mi?`)) return;
                          await bridge.remove(entry.id);
                          await refresh();
                        }}
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {formOpen ? (
        <VaultEntryForm
          onClose={() => setFormOpen(false)}
          onSaved={async () => { setFormOpen(false); await refresh(); }}
        />
      ) : null}
    </>
  );
}
