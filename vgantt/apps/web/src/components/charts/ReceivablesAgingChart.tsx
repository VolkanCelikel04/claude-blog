import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ChartFrame } from './ChartFrame';
import { chartColors, compactCurrency, currency } from './chart-theme';
import type { FinanceOverview } from '../../lib/types';

interface Props {
  aging: FinanceOverview['aging'];
}

const BUCKET_LABELS: Record<string, string> = {
  current: 'Vadesi gelmemiş',
  '1-30': '1-30 gün geçmiş',
  '31-60': '31-60 gün geçmiş',
  '61-90': '61-90 gün geçmiş',
  '90+': '90+ gün geçmiş',
};

const BUCKET_ORDER = ['current', '1-30', '31-60', '61-90', '90+'];

/**
 * Ageing is an ordered scale, not a set of unrelated categories, so it gets the
 * single-hue ordinal ramp (light = fresh, dark = long overdue) rather than
 * categorical hues. Horizontal bars because the labels are long sentences.
 */
export function ReceivablesAgingChart({ aging }: Props) {
  const colors = chartColors();

  const byBucket = new Map(aging.map((row) => [row.bucket, row]));
  const data = BUCKET_ORDER.map((bucket, index) => ({
    bucket,
    label: BUCKET_LABELS[bucket] ?? bucket,
    outstanding: byBucket.get(bucket)?.outstanding ?? 0,
    invoiceCount: byBucket.get(bucket)?.invoiceCount ?? 0,
    color: colors.ramp[index],
  }));

  const total = data.reduce((sum, row) => sum + row.outstanding, 0);

  if (total === 0) {
    return (
      <ChartFrame title="Alacak yaşlandırma" table={<p className="empty">Açık alacak yok.</p>}>
        <p className="empty">Açık alacak bulunmuyor.</p>
      </ChartFrame>
    );
  }

  return (
    <ChartFrame
      title="Alacak yaşlandırma"
      note="Açık bakiyenin vade aşımına göre dağılımı"
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Bant</th>
              <th className="num">Fatura</th>
              <th className="num">Açık bakiye</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={row.bucket}>
                <td>{row.label}</td>
                <td className="num">{row.invoiceCount}</td>
                <td className="num">{currency.format(row.outstanding)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 84, left: 4, bottom: 4 }} barCategoryGap={6}>
            <CartesianGrid stroke={colors.grid} strokeWidth={1} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fill: colors.muted, fontSize: 11.5 }}
              tickLine={false}
              axisLine={{ stroke: colors.axis }}
              tickFormatter={(value: number) => compactCurrency.format(value)}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={140}
              tick={{ fill: colors.muted, fontSize: 11.5 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip cursor={{ fill: 'transparent' }} content={<AgingTooltip />} />
            <Bar dataKey="outstanding" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {data.map((row) => (
                // 2px surface stroke is the gap between adjacent fills, not a border.
                <Cell key={row.bucket} fill={row.color} stroke={colors.surface} strokeWidth={2} />
              ))}
              <LabelList
                dataKey="outstanding"
                position="right"
                offset={10}
                fill={colors.muted}
                fontSize={11.5}
                formatter={(value: number) => (value > 0 ? compactCurrency.format(value) : '')}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

function AgingTooltip({
  active, payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { label: string; outstanding: number; invoiceCount: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{row.label}</div>
      <div className="chart-tooltip__row">
        Açık bakiye<span className="chart-tooltip__value">{currency.format(row.outstanding)}</span>
      </div>
      <div className="chart-tooltip__row">
        Fatura adedi<span className="chart-tooltip__value">{row.invoiceCount}</span>
      </div>
    </div>
  );
}
