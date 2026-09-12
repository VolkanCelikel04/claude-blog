import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api-client';
import type { Notification } from '../../lib/types';

export function NotificationBell({ items, unread }: { items: Notification[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const markAll = useMutation({
    mutationFn: () => api('/notifications/read-all', { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Bildirimler{unread > 0 ? ` (${unread})` : ''}
      </button>

      {open ? (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 380, zIndex: 20, maxHeight: 460, overflowY: 'auto' }}
        >
          <div className="card__head">
            <h3 className="card__title">Bildirimler</h3>
            <button
              type="button"
              className="button button--ghost"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Tümünü okundu işaretle
            </button>
          </div>

          {items.length === 0 ? (
            <p className="empty">Bildirim yok.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
              {items.map((item) => (
                <li key={item.id} style={{ opacity: item.is_read ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span className={`badge badge--${severityClass(item.severity)}`}>
                      {severityLabel(item.severity, item.threshold_days)}
                    </span>
                    <strong style={{ fontSize: 13 }}>{item.title}</strong>
                  </div>
                  {item.body ? <div className="muted" style={{ fontSize: 12.5 }}>{item.body}</div> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function severityClass(severity: Notification['severity']): string {
  return severity === 'critical' ? 'critical' : severity === 'warning' ? 'warning' : 'upcoming';
}

/** The badge says what it means, so severity is never colour-alone. */
function severityLabel(severity: Notification['severity'], days: number | null): string {
  if (days !== null && days < 0) return `${Math.abs(days)} gün gecikti`;
  if (days === 0) return 'Bugün';
  if (days !== null) return `${days} gün kaldı`;
  return severity === 'critical' ? 'Kritik' : severity === 'warning' ? 'Uyarı' : 'Bilgi';
}
