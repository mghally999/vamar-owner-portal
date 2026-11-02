/**
 * A small accessible SVG bar chart: one group per month, up to three series (rent collected,
 * expenses, expected). Colours come from the theme tokens so both themes work; the data is also
 * rendered as a visually hidden table for screen readers.
 */
import { formatMonth, type PlainDate } from '@vamar/shared';
import { useI18n } from '@/lib/i18n';

export interface BarSeries {
  key: string;
  label: string;
  /** CSS colour; defaults are theme tokens. */
  color?: string;
  values: number[];
}

export function BarChart({
  months,
  series,
  title,
  height = 160,
}: {
  /** `YYYY-MM` keys, one per group. */
  months: string[];
  series: BarSeries[];
  title: string;
  height?: number;
}) {
  const { lang, money } = useI18n();
  const colors = ['var(--color-primary)', 'var(--color-status-bounced)', 'var(--color-border)'];
  const max = Math.max(1, ...series.flatMap((s) => s.values.map((v) => Math.abs(v))));
  const groupW = 100 / Math.max(1, months.length);
  const barW = Math.max(1, (groupW * 0.7) / Math.max(1, series.length));
  const label = (m: string) => {
    const name = formatMonth(`${m}-01` as PlainDate, lang);
    return lang === 'ar' ? (name.split(' ')[0] ?? name) : name.slice(0, 3);
  };
  return (
    <figure className="rounded-lg border border-line bg-elevated p-4 shadow-card">
      <figcaption className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
        <span className="font-medium">{title}</span>
        <span className="flex flex-wrap gap-3">
          {series.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1 text-ink-soft">
              <span
                className="inline-block size-3 rounded-sm"
                style={{ background: s.color ?? colors[i % colors.length] }}
                aria-hidden
              />
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg
        viewBox={`0 0 100 ${height / 4 + 8}`}
        preserveAspectRatio="none"
        className="block h-auto w-full"
        style={{ height }}
        role="img"
        aria-label={title}
      >
        {months.map((m, gi) => (
          <g key={m}>
            {series.map((s, si) => {
              const v = s.values[gi] ?? 0;
              const h = (Math.abs(v) / max) * (height / 4);
              const x = gi * groupW + groupW * 0.15 + si * barW;
              return (
                <rect
                  key={s.key}
                  x={x}
                  y={height / 4 - h}
                  width={barW * 0.9}
                  height={h}
                  fill={s.color ?? colors[si % colors.length]}
                  rx={0.5}
                >
                  <title>{`${label(m)} · ${s.label}: ${money(v)}`}</title>
                </rect>
              );
            })}
            <text
              x={gi * groupW + groupW / 2}
              y={height / 4 + 6}
              fontSize={3.2}
              textAnchor="middle"
              fill="var(--color-ink-soft)"
            >
              {label(m)}
            </text>
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">{lang === 'ar' ? 'الشهر' : 'Month'}</th>
            {series.map((s) => (
              <th key={s.key} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, gi) => (
            <tr key={m}>
              <th scope="row">{formatMonth(`${m}-01` as PlainDate, lang)}</th>
              {series.map((s) => (
                <td key={s.key}>{money(s.values[gi] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
