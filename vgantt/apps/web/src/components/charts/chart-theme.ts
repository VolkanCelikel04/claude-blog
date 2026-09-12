/**
 * Chart tokens read from CSS custom properties, so a single stylesheet drives
 * both the UI and the charts and dark mode needs no second palette in JS.
 *
 * The values themselves were validated with the data-viz palette validator:
 *   categorical slots 1-3  -> worst adjacent CVD dE 9.2 light / 9.4 dark
 *   ordinal ramp (5 steps) -> monotone lightness, light end clears 2:1
 * Light-mode slot 3 sits below 3:1 against the surface, so every chart here
 * ships direct labels plus a table view - the documented relief.
 */
export function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const chartColors = () => ({
  series1: cssVar('--series-1', '#2a78d6'),
  series2: cssVar('--series-2', '#eb6834'),
  series3: cssVar('--series-3', '#1baf7a'),
  ramp: [
    cssVar('--ramp-1', '#86b6ef'),
    cssVar('--ramp-2', '#5598e7'),
    cssVar('--ramp-3', '#2a78d6'),
    cssVar('--ramp-4', '#1c5cab'),
    cssVar('--ramp-5', '#104281'),
  ],
  grid: cssVar('--grid-line', '#e1e0d9'),
  axis: cssVar('--axis-line', '#c3c2b7'),
  muted: cssVar('--text-muted', '#898781'),
  surface: cssVar('--surface-1', '#fcfcfb'),
});

export const currency = new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  maximumFractionDigits: 0,
});

export const compactCurrency = new Intl.NumberFormat('tr-TR', {
  notation: 'compact',
  compactDisplay: 'short',
  maximumFractionDigits: 1,
});

export function monthLabel(iso: string): string {
  const [year, month] = iso.split('-');
  const names = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${names[Number(month) - 1]} ${year.slice(2)}`;
}
