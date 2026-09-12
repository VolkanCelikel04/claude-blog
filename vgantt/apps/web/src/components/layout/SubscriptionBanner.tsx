import type { TenantSession } from '../../lib/types';

/**
 * The tenant-side half of the licence warning ladder. The same 30/15/7/3 bands
 * the alert engine uses, so the banner and the notification always agree.
 */
export function SubscriptionBanner({ subscription }: { subscription: TenantSession['subscription'] }) {
  if (!subscription || subscription.daysRemaining === null) return null;

  const days = subscription.daysRemaining;
  if (days > 30) return null;

  const tone = days <= 3 ? 'critical' : days <= 15 ? 'warning' : 'info';
  const icon = days <= 3 ? '!' : days <= 15 ? '!' : 'i';

  const message =
    days < 0
      ? `Aboneliğinizin süresi ${Math.abs(days)} gün önce doldu.`
      : days === 0
        ? 'Aboneliğiniz bugün sona eriyor.'
        : `Aboneliğinizin bitimine ${days} gün kaldı.`;

  return (
    <div className={`banner banner--${tone}`} role={days <= 3 ? 'alert' : 'status'}>
      <strong aria-hidden="true">{icon}</strong>
      <div>
        <strong>{message}</strong>
        {subscription.endsOn ? (
          <div className="muted">Bitiş tarihi: {new Date(subscription.endsOn).toLocaleDateString('tr-TR')}</div>
        ) : null}
      </div>
    </div>
  );
}
