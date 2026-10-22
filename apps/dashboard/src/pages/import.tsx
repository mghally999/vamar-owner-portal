/**
 * Excel import: parse in the browser (SheetJS), pick the sheet and target, map columns, dry-run
 * with the shared zod schemas, then commit in one request with an idempotency key.
 */
import { useMemo, useState } from 'react';
import type * as Xlsx from 'xlsx';
import type { WorkBook } from 'xlsx';

// SheetJS is ~400 KB; it is loaded only when a file is chosen, never in the main bundle.
let xlsx: typeof Xlsx | null = null;
const loadXlsx = async () => (xlsx ??= await import('xlsx'));
import { z } from 'zod';
import {
  createBuildingSchema,
  createOwnerSchema,
  createTenantSchema,
  createUnitSchema,
  UNIT_TYPES,
} from '@vamar/shared';
import { request } from '@/lib/api';
import { chunk, IMPORT_BATCH_SIZE } from '@/lib/batch';
import { useI18n } from '@/lib/i18n';
import type { MessageKey } from '@/lib/messages';
import { Button, Card, Field, PageHeader, SectionTitle, Select, Toast } from '@/ui/primitives';
import { Page } from '@/ui/shell';

type Target = 'owners' | 'buildings' | 'units' | 'tenants';

const FIELDS: Record<
  Target,
  { key: string; label: { ar: string; en: string }; required?: boolean }[]
> = {
  owners: [
    { key: 'nameAr', label: { ar: 'الاسم (عربي)', en: 'Name (Arabic)' }, required: true },
    { key: 'nameEn', label: { ar: 'الاسم (إنجليزي)', en: 'Name (English)' }, required: true },
    { key: 'phoneE164', label: { ar: 'الهاتف', en: 'Phone' }, required: true },
    { key: 'email', label: { ar: 'البريد', en: 'Email' } },
    { key: 'preferredLang', label: { ar: 'اللغة (ar/en)', en: 'Language (ar/en)' } },
  ],
  buildings: [
    { key: 'nameAr', label: { ar: 'اسم المبنى (عربي)', en: 'Building (Arabic)' }, required: true },
    {
      key: 'nameEn',
      label: { ar: 'اسم المبنى (إنجليزي)', en: 'Building (English)' },
      required: true,
    },
    { key: 'area', label: { ar: 'المنطقة', en: 'Area' }, required: true },
    { key: 'address', label: { ar: 'العنوان', en: 'Address' } },
  ],
  units: [
    { key: 'building', label: { ar: 'المبنى (الاسم)', en: 'Building (name)' }, required: true },
    { key: 'unitNo', label: { ar: 'رقم الوحدة', en: 'Unit no.' }, required: true },
    { key: 'type', label: { ar: 'النوع', en: 'Type' } },
    { key: 'bedrooms', label: { ar: 'غرف النوم', en: 'Bedrooms' } },
    { key: 'sizeSqft', label: { ar: 'المساحة', en: 'Size (sq ft)' } },
  ],
  tenants: [
    { key: 'name', label: { ar: 'الاسم', en: 'Name' }, required: true },
    { key: 'phone', label: { ar: 'الهاتف', en: 'Phone' } },
    { key: 'email', label: { ar: 'البريد', en: 'Email' } },
    { key: 'company', label: { ar: 'الشركة', en: 'Company' } },
  ],
};

const unitClientSchema = createUnitSchema
  .omit({ buildingId: true })
  .extend({ building: z.string().trim().min(1), type: z.enum(UNIT_TYPES).default('apartment') });
const SCHEMAS: Record<Target, z.ZodType> = {
  owners: createOwnerSchema,
  buildings: createBuildingSchema,
  units: unitClientSchema,
  tenants: createTenantSchema,
};

/** Normalise cell values: trim strings, coerce numbers, phones to E.164, empty -> undefined. */
function coerce(key: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return undefined;
  let v: unknown = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '') return undefined;
  if (key === 'phoneE164' || key === 'phone') {
    const digits = cellText(v).replace(/[^\d+]/g, '');
    if (digits.startsWith('+')) v = digits;
    else if (digits.startsWith('00')) v = `+${digits.slice(2)}`;
    else if (digits.startsWith('971')) v = `+${digits}`;
    else if (digits.startsWith('0')) v = `+971${digits.slice(1)}`;
    else v = `+971${digits}`;
  }
  if (key === 'bedrooms' || key === 'sizeSqft') v = Number(v);
  if (key === 'type' && typeof v === 'string') v = v.toLowerCase();
  if (key === 'preferredLang' && typeof v === 'string')
    v = v.toLowerCase().startsWith('en') ? 'en' : 'ar';
  if (key === 'unitNo') v = cellText(v);
  return v;
}

/** Text for a spreadsheet cell: SheetJS gives strings, numbers, booleans or Date objects. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return JSON.stringify(v);
}

/** First 16 hex digits of the file's SHA-256: the same file always gets the same import key. */
async function fileFingerprint(buf: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function ImportPage() {
  const { t, lang } = useI18n();
  const [wb, setWb] = useState<WorkBook | null>(null);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState('');
  const [target, setTarget] = useState<Target>('owners');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{
    rowsOk: number;
    rowsFailed: number;
    results: { row: number; ok: boolean; errors?: string[] }[];
    alreadyDone?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [fingerprint, setFingerprint] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const rows = useMemo(() => {
    if (!wb || !sheet) return [] as Record<string, unknown>[];
    const ws = wb.Sheets[sheet];
    return ws && xlsx ? xlsx.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' }) : [];
  }, [wb, sheet]);
  const columns = useMemo(() => (rows[0] ? Object.keys(rows[0]) : []), [rows]);

  // Dry run: shape each row with the mapping and validate with the shared schema.
  const dryRun = useMemo(() => {
    const schema = SCHEMAS[target];
    return rows.map((r, i) => {
      const data: Record<string, unknown> = {};
      for (const f of FIELDS[target]) {
        const col = mapping[f.key];
        if (col) {
          const v = coerce(f.key, r[col]);
          if (v !== undefined) data[f.key] = v;
        }
      }
      const parsed = schema.safeParse(data);
      return {
        row: i + 2,
        data,
        ok: parsed.success,
        errors: parsed.success
          ? []
          : parsed.error.issues.map((is) => `${is.path.join('.')}: ${is.message}`),
      };
    });
  }, [rows, mapping, target]);
  const okRows = dryRun.filter((r) => r.ok);

  async function onFile(file: File) {
    const buf = await file.arrayBuffer();
    const { read } = await loadXlsx();
    const book = read(buf, { type: 'array' });
    setFingerprint(await fileFingerprint(buf));
    setWb(book);
    setFileName(file.name);
    setSheet(book.SheetNames[0] ?? '');
    setMapping({});
    setResult(null);
  }

  function autoMap(tg: Target, cols: string[]) {
    const m: Record<string, string> = {};
    for (const f of FIELDS[tg]) {
      // A header that starts with the field key (as in vamar-import-template.xlsx) wins.
      const exact = cols.find(
        (c) => c.trim().split(/[s|(]/)[0]?.toLowerCase() === f.key.toLowerCase(),
      );
      if (exact) {
        m[f.key] = exact;
        continue;
      }
      const hit = cols.find((c) => {
        const n = c.toLowerCase().replace(/[^a-z؀-ۿ]/g, '');
        return (
          n.includes(f.key.toLowerCase().replace('e164', '')) ||
          n.includes(f.label.ar.replace(/[^؀-ۿ]/g, '').slice(0, 4)) ||
          n.includes(
            f.label.en
              .toLowerCase()
              .replace(/[^a-z]/g, '')
              .slice(0, 5),
          )
        );
      });
      if (hit) m[f.key] = hit;
    }
    setMapping(m);
  }

  async function commit() {
    setBusy(true);
    const batches = chunk(okRows, IMPORT_BATCH_SIZE);
    const total = {
      rowsOk: 0,
      rowsFailed: 0,
      results: [] as NonNullable<typeof result>['results'],
      alreadyDone: false,
    };
    try {
      for (const [i, batch] of batches.entries()) {
        setProgress({ done: i * IMPORT_BATCH_SIZE, total: okRows.length });
        const r = await request<NonNullable<typeof result>>('/api/staff/import/commit', {
          method: 'POST',
          body: JSON.stringify({
            target,
            fileName,
            idempotencyKey: `${fingerprint}:${target}:${sheet}:${String(i)}`,
            rows: batch.map((x) => ({ row: x.row, data: x.data })),
          }),
        });
        total.rowsOk += r.rowsOk;
        total.rowsFailed += r.rowsFailed;
        total.results.push(...r.results);
        total.alreadyDone ||= r.alreadyDone === true;
      }
      setResult(total);
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title={t('import_title')}
        subtitle={t('import_intro')}
        actions={
          <a
            href="/vamar-import-template.xlsx"
            download
            className="inline-flex h-11 items-center rounded-md border border-line-strong px-4 text-[15px] font-medium hover:bg-sunken"
          >
            {t('import_template')}
          </a>
        }
      />
      <Card className="grid gap-4 p-5 sm:grid-cols-3">
        <Field label={t('import_pickFile')} required>
          <div className="flex h-11 items-center gap-3">
            <label className="inline-flex h-11 cursor-pointer items-center rounded-md border border-line-strong bg-elevated px-3 text-[15px] font-medium hover:bg-sunken">
              {t('import_chooseFile')}
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>
            <span className="truncate text-[15px] text-ink-soft" dir="auto">
              {fileName || t('import_noFile')}
            </span>
          </div>
        </Field>
        <Field label={t('import_sheet')} required>
          <Select
            value={sheet}
            onChange={(e) => {
              setSheet(e.target.value);
            }}
            disabled={!wb}
          >
            {wb?.SheetNames.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('import_target')} required>
          <Select
            value={target}
            onChange={(e) => {
              const tg = e.target.value as Target;
              setTarget(tg);
              autoMap(tg, columns);
              setResult(null);
            }}
          >
            {(['owners', 'buildings', 'units', 'tenants'] as Target[]).map((tg) => (
              <option key={tg} value={tg}>
                {t(`import_target_${tg}` as MessageKey)}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {columns.length > 0 ? (
        <section>
          <SectionTitle
            aside={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  autoMap(target, columns);
                }}
              >
                {t('import_mapColumns')}
              </Button>
            }
          >
            {t('import_mapColumns')}
          </SectionTitle>
          <Card className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS[target].map((f) => (
              <Field
                key={f.key}
                label={lang === 'ar' ? f.label.ar : f.label.en}
                required={f.required}
              >
                <Select
                  value={mapping[f.key] ?? ''}
                  onChange={(e) => {
                    setMapping({ ...mapping, [f.key]: e.target.value });
                  }}
                >
                  <option value="">{t('import_ignore')}</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </Card>
        </section>
      ) : null}

      {rows.length > 0 ? (
        <section>
          <SectionTitle
            aside={
              <Button
                onClick={() => void commit()}
                disabled={okRows.length === 0 || result !== null}
                loading={busy}
              >
                {progress
                  ? t('import_progress', { done: progress.done, total: progress.total })
                  : t('import_commit', { n: okRows.length })}
              </Button>
            }
          >
            {t('import_dryRun')}
          </SectionTitle>
          {result ? (
            <Toast kind={result.rowsFailed ? 'info' : 'success'}>
              {result.alreadyDone ? `${t('import_alreadyDone')} ` : ''}
              {t('import_done', { ok: result.rowsOk, failed: result.rowsFailed })}
            </Toast>
          ) : null}
          <p className="mb-2 text-[15px] text-ink-soft">
            <span className="text-status-cleared">{t('import_rowsOk', { n: okRows.length })}</span>{' '}
            ·{' '}
            <span className={dryRun.length - okRows.length ? 'text-status-bounced' : ''}>
              {t('import_rowsFailed', { n: dryRun.length - okRows.length })}
            </span>
          </p>
          <Card className="max-h-[480px] overflow-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="row-line text-ink-soft">
                  <th className="px-3 py-2 text-start font-medium">{t('import_row')}</th>
                  {FIELDS[target].map((f) => (
                    <th key={f.key} className="px-3 py-2 text-start font-medium">
                      {lang === 'ar' ? f.label.ar : f.label.en}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-start font-medium">{t('import_errors')}</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.map((r) => {
                  const serverErrors = result?.results.find((x) => x.row === r.row)?.errors;
                  return (
                    <tr
                      key={r.row}
                      className={`row-line last:border-b-0 ${!r.ok || serverErrors ? 'bg-status-bounced-bg/40' : ''}`}
                    >
                      <td className="px-3 py-2 tnum text-ink-soft">{r.row}</td>
                      {FIELDS[target].map((f) => (
                        <td key={f.key} className="px-3 py-2" dir="auto">
                          {cellText(r.data[f.key])}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-status-bounced">
                        {[...r.errors, ...(serverErrors ?? [])].join('; ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>
      ) : null}
    </Page>
  );
}
