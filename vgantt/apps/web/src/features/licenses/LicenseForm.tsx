import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api-client';

const TYPES = [
  ['software', 'Yazılım'],
  ['domain', 'Domain'],
  ['ssl_certificate', 'SSL sertifikası'],
  ['hosting', 'Hosting'],
  ['subscription', 'Abonelik'],
  ['hardware_warranty', 'Donanım garantisi'],
  ['insurance', 'Sigorta'],
  ['certification', 'Belge / sertifikasyon'],
  ['other', 'Diğer'],
] as const;

export function LicenseForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', licenseType: 'software', vendor: '', accountReference: '',
    endDate: '', cost: '', autoRenew: false,
  });

  const create = useMutation({
    mutationFn: () =>
      api('/licenses', {
        method: 'POST',
        body: {
          name: form.name,
          licenseType: form.licenseType,
          vendor: form.vendor || undefined,
          accountReference: form.accountReference || undefined,
          endDate: form.endDate,
          cost: form.cost ? Number(form.cost) : undefined,
          autoRenew: form.autoRenew,
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      onClose();
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Yeni lisans kaydı"
      style={{
        position: 'fixed', inset: 0, background: 'rgba(11,11,11,0.45)',
        display: 'grid', placeItems: 'center', padding: 20, zIndex: 50,
      }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <form className="card" style={{ width: 'min(520px, 100%)' }} onSubmit={submit}>
        <h2 className="card__title" style={{ marginBottom: 16 }}>Yeni lisans kaydı</h2>

        {create.error ? (
          <div className="banner banner--critical" role="alert">
            {create.error instanceof ApiError ? create.error.message : 'Kayıt oluşturulamadı.'}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="lic-name">Kayıt adı</label>
          <input id="lic-name" className="input" required value={form.name}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>

        <div className="field">
          <label htmlFor="lic-type">Tür</label>
          <select id="lic-type" className="select" value={form.licenseType}
                  onChange={(e) => setForm({ ...form, licenseType: e.target.value })}>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>

        <div className="field">
          <label htmlFor="lic-vendor">Tedarikçi</label>
          <input id="lic-vendor" className="input" value={form.vendor}
                 onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        </div>

        <div className="field">
          <label htmlFor="lic-ref">
            Hesap / müşteri no
            <span className="muted"> - şifre girmeyin, şifreler kasada saklanır</span>
          </label>
          <input id="lic-ref" className="input" value={form.accountReference}
                 onChange={(e) => setForm({ ...form, accountReference: e.target.value })} />
        </div>

        <div className="field">
          <label htmlFor="lic-end">Bitiş tarihi</label>
          <input id="lic-end" className="input" type="date" required value={form.endDate}
                 onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
        </div>

        <div className="field">
          <label htmlFor="lic-cost">Tutar (TRY)</label>
          <input id="lic-cost" className="input" type="number" min="0" step="0.01" value={form.cost}
                 onChange={(e) => setForm({ ...form, cost: e.target.value })} />
        </div>

        <label className="switch" style={{ marginBottom: 16 }}>
          <input type="checkbox" checked={form.autoRenew}
                 onChange={(e) => setForm({ ...form, autoRenew: e.target.checked })} />
          <span className="switch__track" /><span className="switch__thumb" />
          <span>Otomatik yenileniyor</span>
        </label>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="button" onClick={onClose}>Vazgeç</button>
          <button type="submit" className="button button--primary" disabled={create.isPending}>
            {create.isPending ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </form>
    </div>
  );
}
