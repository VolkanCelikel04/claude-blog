import { useId, useState, type ReactNode } from 'react';

interface LegendItem {
  label: string;
  color: string;
}

interface ChartFrameProps {
  title: string;
  note?: string;
  legend?: LegendItem[];
  /** The WCAG-clean twin. Every chart here has one. */
  table: ReactNode;
  children: ReactNode;
}

/**
 * Card + title + legend + a table-view toggle.
 *
 * The table is not an optional extra: it is how a value stays reachable when
 * colour alone would not carry it (low-contrast slot, colour-vision deficiency,
 * print). Keeping it in the frame means no chart can forget to ship one.
 */
export function ChartFrame({ title, note, legend, table, children }: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const panelId = useId();

  return (
    <section className="card">
      <header className="card__head">
        <div>
          <h3 className="card__title">{title}</h3>
          {note ? <p className="card__note" style={{ margin: '3px 0 0' }}>{note}</p> : null}
        </div>
        <button
          type="button"
          className="button button--ghost"
          aria-expanded={showTable}
          aria-controls={panelId}
          onClick={() => setShowTable((value) => !value)}
        >
          {showTable ? 'Grafiği göster' : 'Tabloyu göster'}
        </button>
      </header>

      {legend && legend.length > 1 ? (
        <div className="chart-legend" style={{ marginBottom: 12 }}>
          {legend.map((item) => (
            <span className="chart-legend__item" key={item.label}>
              <span className="chart-legend__swatch" style={{ background: item.color }} aria-hidden="true" />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}

      <div id={panelId}>{showTable ? <div className="table-scroll">{table}</div> : children}</div>
    </section>
  );
}
