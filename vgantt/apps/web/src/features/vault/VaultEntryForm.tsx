import { useState, type FormEvent } from 'react';
import { vaultBridge } from './vault-bridge';

export function VaultEntryForm({ onClose, onSaved }: { onClose(): void; onSaved(): Promise<void> }) {
  const bridge = vaultBridge();
  const [form, setForm] = useState({
    title: '', category: '', url: '', username: '', password: '', notes: '', tags: '',
  });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!bridge) return;

    setBusy(true);
    try {
      // Goes straight to the Electron main process and into the local file.
      // There is no API call on this path, by design.
      await bridge.add({
        ...form,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      });
      await onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Yeni kasa kaydı"
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,11,11,0.45)', display: 'grid', placeItems: 'center', padding: 20, zIndex: 50 }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <form className="card" style={{ width: 'min(520px, 100%)' }} onSubmit={submit}>
        <h2 className="card__title" style={{ marginBottom: 4 }}>Yeni kasa kaydı</h2>
        <p className="muted" style={{ fontSize: 12, marginTop: 0, marginBottom: 16 }}>
          Bu kayıt yalnızca bu bilgisayardaki kasa dosyasına yazılır.
        </p>

        {([
          ['title', 'Başlık', 'text', true],
          ['category', 'Kategori', 'text', false],
          ['url', 'Adres / URL', 'text', false],
          ['username', 'Kullanıcı adı', 'text', false],
          ['password', 'Şifre', 'password', false],
          ['tags', 'Etiketler (virgülle)', 'text', false],
        ] as const).map(([key, label, type, required]) => (
          <div className="field" key={key}>
            <label htmlFor={`vault-${key}`}>{label}</label>
            <input
              id={`vault-${key}`} className="input" type={type} required={required}
              autoComplete="off"
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </div>
        ))}

        <div className="field">
          <label htmlFor="vault-notes">Notlar</label>
          <textarea
            id="vault-notes" className="input" rows={3} value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="button" onClick={onClose}>Vazgeç</button>
          <button type="submit" className="button button--primary" disabled={busy || !form.title}>
            {busy ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
}
