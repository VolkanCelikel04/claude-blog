import type { LicenseRow } from '../../lib/types';

const LABELS: Record<LicenseRow['expiry_bucket'], string> = {
  expired: 'Süresi doldu',
  critical: 'Son 3 gün',
  urgent: 'Son 7 gün',
  warning: 'Son 15 gün',
  upcoming: 'Son 30 gün',
  ok: 'Zamanı var',
  inactive: 'Pasif',
};

/**
 * Status always ships as colour + text. A reader who cannot separate the hues
 * still gets "Süresi doldu" and the day count.
 */
export function ExpiryBadge({ bucket, days }: { bucket: LicenseRow['expiry_bucket']; days: number }) {
  const className =
    bucket === 'expired' || bucket === 'critical' ? 'critical'
      : bucket === 'urgent' ? 'urgent'
      : bucket === 'warning' ? 'warning'
      : bucket === 'upcoming' ? 'upcoming'
      : 'ok';

  const detail = days < 0 ? `${Math.abs(days)} gün önce` : days === 0 ? 'bugün' : `${days} gün`;

  return (
    <span className={`badge badge--${className}`}>
      {LABELS[bucket]} <span className="mono">· {detail}</span>
    </span>
  );
}
