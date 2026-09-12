interface StatTileProps {
  label: string;
  value: string;
  hint?: string;
  tone?: 'neutral' | 'warning' | 'critical';
}

/**
 * When the story is one number, a tile is the chart. Proportional figures on
 * purpose: tabular-nums makes a large standalone number look loose.
 */
export function StatTile({ label, value, hint, tone = 'neutral' }: StatTileProps) {
  return (
    <div className={`stat${tone === 'critical' ? ' stat--critical' : tone === 'warning' ? ' stat--warning' : ''}`}>
      <p className="stat__label">{label}</p>
      <p className="stat__value">{value}</p>
      {hint ? <p className="stat__hint">{hint}</p> : null}
    </div>
  );
}
