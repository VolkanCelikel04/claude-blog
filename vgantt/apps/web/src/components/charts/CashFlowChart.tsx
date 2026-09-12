import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, LabelList,
} from 'recharts';
import { ChartFrame } from './ChartFrame';
import { chartColors, compactCurrency, currency, monthLabel } from './chart-theme';
import type { FinanceOverview } from '../../lib/types';

interface Props {
  monthly: FinanceOverview['monthly'];
}

/**
 * Twelve months of money in and money out.
 *
 * One y-axis for all three series - they are all TRY, so there is no excuse for
 * a second scale. Lines rather than grouped bars because the question is
 * "which way is this trending", not "compare these two months".
 *
 * Direct labels sit on the final point only: a number on every point would be
 * unreadable, and the axis plus the tooltip carry the rest.
 */
export function CashFlowChart({ monthly }: Props) {
  const colors = chartColors();

  const data = monthly.map((point) => ({
    month: monthLabel(point.month),
    Faturalanan: point.invoiced,
    'Tahsil edilen': point.collected,
    'Ödenen gider': point.expensePaid,
  }));

  const series = [
    { key: 'Faturalanan', color: colors.series1 },
    { key: 'Ödenen gider', color: colors.series2 },
    { key: 'Tahsil edilen', color: colors.series3 },
  ] as const;

  return (
    <ChartFrame
      title="Aylık nakit akışı"
      note="Son 12 ay - faturalanan, tahsil edilen ve ödenen gider"
      legend={series.map((s) => ({ label: s.key, color: s.color }))}
      table={
        <table className="table">
          <thead>
            <tr>
              <th>Ay</th>
              <th className="num">Faturalanan</th>
              <th className="num">Tahsil edilen</th>
              <th className="num">Ödenen gider</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {monthly.map((point) => (
              <tr key={point.month}>
                <td>{monthLabel(point.month)}</td>
                <td className="num">{currency.format(point.invoiced)}</td>
                <td className="num">{currency.format(point.collected)}</td>
                <td className="num">{currency.format(point.expensePaid)}</td>
                <td className="num">{currency.format(point.netCash)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 76, left: 4, bottom: 4 }}>
            <CartesianGrid stroke={colors.grid} strokeWidth={1} vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: colors.muted, fontSize: 11.5 }}
              tickLine={false}
              axisLine={{ stroke: colors.axis }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fill: colors.muted, fontSize: 11.5 }}
              tickLine={false}
              axisLine={false}
              width={54}
              tickFormatter={(value: number) => compactCurrency.format(value)}
            />
            <Tooltip
              cursor={{ stroke: colors.axis, strokeWidth: 1 }}
              content={<CashFlowTooltip />}
            />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4.5, strokeWidth: 2, stroke: colors.surface }}
                isAnimationActive={false}
              >
                <LabelList
                  dataKey={s.key}
                  content={(props) => <EndpointLabel {...props} label={s.key} color={s.color} total={data.length} />}
                />
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}

interface TooltipPayloadItem {
  name: string;
  value: number;
  color: string;
}

function CashFlowTooltip({
  active, label, payload,
}: { active?: boolean; label?: string; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__label">{label}</div>
      {payload.map((item) => (
        <div className="chart-tooltip__row" key={item.name}>
          <span className="chart-legend__swatch" style={{ background: item.color }} aria-hidden="true" />
          {item.name}
          <span className="chart-tooltip__value">{currency.format(item.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Labels the last point of a line, and nothing else. */
function EndpointLabel(props: {
  x?: number; y?: number; index?: number; value?: number;
  label: string; color: string; total: number;
}) {
  const { x, y, index, value, color, total } = props;
  if (index !== total - 1 || x === undefined || y === undefined || value === undefined) return null;

  return (
    <text x={x + 8} y={y} dy={4} fill={color} fontSize={11.5} fontWeight={600}>
      {compactCurrency.format(value)}
    </text>
  );
}
