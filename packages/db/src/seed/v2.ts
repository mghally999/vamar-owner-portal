/**
 * Demo data for the v2 features: eighteen months of fixed costs from recurring rules (salaries,
 * DEWA/SEWA, lift contracts, insurance), a handful of variable costs (a lift repair, an AC
 * breakdown with before and after photos, legal fees on the bounced-cheque case), work orders,
 * unit statuses and identifiers, the cheques behind the dispute, calendar events. Everything is
 * relative to "today" so the demo always has a draft waiting for staff, a job scheduled next
 * week and a hearing about a week away.
 */
import {
  addDays,
  addMonthsClamped,
  allocateExpense,
  expenseTotal,
  ownersOnDate,
  recurringDueDates,
  vatFor,
  type AllocationMethod,
  type OwnershipRow,
  type PlainDate,
  type RecurringFrequency,
} from '@vamar/shared';
import { eq as eqId } from 'drizzle-orm';
import * as s from '../schema/index.js';
import { uuidv7 } from '../schema/_common.js';
import type { SeedDb } from './index.js';
import demoImages from './demo-images.json' with { type: 'json' };

/** Writes a demo file where the API expects attachments (R2, the local folder, the test bucket). */
export type SeedFiles = (key: string, bytes: Uint8Array, mime: string) => Promise<void>;

export interface SeedV2Context {
  today: PlainDate;
  adminId: string;
  owners: Record<'khalid' | 'fatima' | 'omar' | 'mariam' | 'rashid', { id: string }>;
  buildings: Record<'noor' | 'safa' | 'khan' | 'mamzar' | 'nahda', { id: string }>;
  units: { id: string; buildingId: string; unitNo: string; sizeSqft: number | null }[];
  ownerships: OwnershipRow[];
  contracts: { id: string; unitId: string; status: string }[];
  cheques: { id: string; contractId: string; status: string }[];
  disputes: {
    id: string;
    caseNo: string;
    unitId: string;
    contractId: string | null;
    type: string;
  }[];
  files?: SeedFiles | undefined;
}

export interface SeedV2Summary {
  vendors: number;
  recurringRules: number;
  expenses: number;
  postedExpenses: number;
  allocations: number;
  workOrders: number;
  calendarEvents: number;
  attachments: number;
}

const AED = (aed: number) => Math.round(aed * 100);

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function seedV2(db: SeedDb, ctx: SeedV2Context): Promise<SeedV2Summary> {
  const { today, adminId } = ctx;
  const unitsOf = (buildingId: string) => ctx.units.filter((u) => u.buildingId === buildingId);
  const unit = (buildingId: string, unitNo: string) => {
    const u = ctx.units.find((x) => x.buildingId === buildingId && x.unitNo === unitNo);
    if (!u) throw new Error(`seed v2: no unit ${unitNo}`);
    return u;
  };

  // Categories come from migration 0007; look them up by English name.
  const categoryRows = await db.select().from(s.expenseCategories);
  const cat = (nameEn: string) => {
    const c = categoryRows.find((x) => x.nameEn === nameEn);
    if (!c) throw new Error(`seed v2: no category ${nameEn}`);
    return c;
  };

  // Vendors ---------------------------------------------------------------------------------
  const vendorRows = [
    {
      id: uuidv7(),
      name: 'Al Hamad Facilities Management LLC',
      phone: '+97143339900',
      email: 'ops@alhamadfm.ae',
      trn: '100234567800003',
      notes: 'Building staff, cleaning and security contracts.',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Cool Breeze AC Services',
      phone: '+971501112233',
      email: 'service@coolbreeze.ae',
      trn: '100345678900003',
      notes: '',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Gulf Lifts Technical Services',
      phone: '+97142221133',
      email: 'support@gulflifts.ae',
      trn: '100456789000003',
      notes: 'Lift maintenance contracts (Al Noor, Al Khan).',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Dubai Electricity and Water Authority (DEWA)',
      phone: '+97146019999',
      email: null,
      trn: null,
      notes: 'Common-area accounts.',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Sharjah Electricity, Water and Gas Authority (SEWA)',
      phone: '+97165288888',
      email: null,
      trn: null,
      notes: '',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Nasser Legal Consultants',
      phone: '+97143456677',
      email: 'cases@nasserlegal.ae',
      trn: '100567890100003',
      notes: 'Rental Dispute Centre filings.',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Clean & Shine Services',
      phone: '+971552223344',
      email: null,
      trn: null,
      notes: 'Deep cleaning and pest control.',
      active: true,
    },
    {
      id: uuidv7(),
      name: 'Orient Insurance PJSC',
      phone: '+97142531300',
      email: null,
      trn: '100678901200003',
      notes: 'Building insurance policies.',
      active: true,
    },
  ];
  await db.insert(s.vendors).values(vendorRows);
  const vendor = (name: string) => {
    const v = vendorRows.find((x) => x.name.startsWith(name));
    if (!v) throw new Error(`seed v2: no vendor ${name}`);
    return v;
  };

  // Building identifiers --------------------------------------------------------------------
  const buildingIds = [
    [
      ctx.buildings.noor.id,
      {
        plotNo: '346-1180',
        makaniNo: '2735894120',
        titleDeedNo: 'BB-2015-0346',
        completionYear: 2016,
        floorsCount: 24,
      },
    ],
    [
      ctx.buildings.safa.id,
      {
        plotNo: '373-0442',
        makaniNo: '2184476325',
        titleDeedNo: 'AB-2009-0373',
        completionYear: 2010,
        floorsCount: 4,
      },
    ],
    [
      ctx.buildings.khan.id,
      {
        plotNo: '512-0077',
        makaniNo: '7011523690',
        titleDeedNo: 'SHJ-KH-0512',
        completionYear: 2012,
        floorsCount: 5,
      },
    ],
    [
      ctx.buildings.mamzar.id,
      {
        plotNo: '208-0019',
        makaniNo: '7052318470',
        titleDeedNo: 'SHJ-MZ-0208',
        completionYear: 2018,
        floorsCount: 2,
      },
    ],
    [
      ctx.buildings.nahda.id,
      {
        plotNo: '241-0906',
        makaniNo: '2961847350',
        titleDeedNo: 'NH-2013-0241',
        completionYear: 2014,
        floorsCount: 3,
      },
    ],
  ] as const;
  for (const [id, fields] of buildingIds)
    await db.update(s.buildings).set(fields).where(eqId(s.buildings.id, id));

  // Unit identifiers: realistic-looking and deterministic. Makani starts with the building's
  // first digits (2 in Dubai, 7 in Sharjah); utility numbers are DEWA premise numbers (9 digits)
  // in Dubai and SEWA account numbers (10 digits) in Sharjah; the title deed and municipality
  // numbers extend the building's own with the unit number.
  const sharjah = new Set<string>([ctx.buildings.khan.id, ctx.buildings.mamzar.id]);
  let idSeed = 3_461_180;
  const digits = (n: number) => {
    let out = '';
    for (let k = 0; k < n; k += 1) {
      idSeed = (idSeed * 1_103_515_245 + 12_345) & 0x7fffffff;
      out += String(Math.floor((idSeed / 0x7fffffff) * 10) % 10);
    }
    return out;
  };
  const nonZeroDigit = () => String(1 + (Number(digits(1)) % 9));
  const usedMakani = new Set<string>(buildingIds.map(([, f]) => f.makaniNo));
  for (const u of ctx.units) {
    const record = buildingIds.find(([id]) => id === u.buildingId)?.[1];
    const prefix = (record?.makaniNo ?? '2000000000').slice(0, 4);
    let makaniNo = prefix + digits(6);
    while (usedMakani.has(makaniNo)) makaniNo = prefix + digits(6);
    usedMakani.add(makaniNo);
    const unitRef = u.unitNo.replace(/[^0-9A-Za-z]/g, '');
    const dewaPremiseNo = sharjah.has(u.buildingId)
      ? `1${digits(8)}${nonZeroDigit()}`
      : `${3 + (Number(digits(1)) % 4)}${digits(7)}${nonZeroDigit()}`;
    await db
      .update(s.units)
      .set({
        titleDeedNo: record ? `${record.titleDeedNo}-${unitRef}` : null,
        plotNo: record?.plotNo ?? null,
        makaniNo,
        dewaPremiseNo,
        municipalityNo: record ? `${record.plotNo}-${unitRef}` : null,
        handoverDate: addMonthsClamped(
          `${record?.completionYear ?? 2015}-06-01` as PlainDate,
          ctx.units.indexOf(u) % 5,
        ),
      })
      .where(eqId(s.units.id, u.id));
  }

  // Manual statuses: a refurbishment and a reserved unit among the vacant ones.
  const khan302 = unit(ctx.buildings.khan.id, '302');
  const safa202 = unit(ctx.buildings.safa.id, '202');
  await db.update(s.units).set({ status: 'under_maintenance' }).where(eqId(s.units.id, khan302.id));
  await db.update(s.units).set({ status: 'reserved' }).where(eqId(s.units.id, safa202.id));
  await db.insert(s.unitStatusEvents).values([
    {
      id: uuidv7(),
      unitId: khan302.id,
      fromStatus: 'vacant_ready',
      toStatus: 'under_maintenance',
      reason: 'تجديد الوحدة قبل التأجير: دهان وصيانة الحمامات',
      actorStaffId: adminId,
      at: new Date(Date.parse(addDays(today, -6))),
    },
    {
      id: uuidv7(),
      unitId: safa202.id,
      fromStatus: 'vacant_ready',
      toStatus: 'reserved',
      reason: 'تم استلام عربون من مستأجر جديد، العقد يبدأ الشهر القادم',
      actorStaffId: adminId,
      at: new Date(Date.parse(addDays(today, -3))),
    },
  ]);

  // Recurring rules (fixed costs) ---------------------------------------------------------
  const since = addMonthsClamped(today, -18);
  interface RuleSeed {
    id: string;
    scope: 'building' | 'unit';
    buildingId: string;
    unitId: string | null;
    categoryId: string;
    vendorId: string | null;
    reasonAr: string;
    reasonEn: string;
    amountFils: number;
    vatFils: number;
    frequency: RecurringFrequency;
    dayOfMonth: number;
    startDate: PlainDate;
    endDate: PlainDate | null;
    allocationMethod: AllocationMethod;
    visibleToOwner: boolean;
    active: boolean;
    createdBy: string;
  }
  const rule = (
    buildingId: string,
    categoryEn: string,
    vendorName: string | null,
    reasonAr: string,
    reasonEn: string,
    aed: number,
    frequency: RecurringFrequency,
    dayOfMonth: number,
    startDate: PlainDate = since,
  ): RuleSeed => {
    const v = vendorName ? vendor(vendorName) : null;
    const amountFils = AED(aed);
    return {
      id: uuidv7(),
      scope: 'building',
      buildingId,
      unitId: null,
      categoryId: cat(categoryEn).id,
      vendorId: v?.id ?? null,
      reasonAr,
      reasonEn,
      amountFils,
      vatFils: v?.trn ? vatFor(amountFils) : 0,
      frequency,
      dayOfMonth,
      startDate,
      endDate: null,
      allocationMethod: unitsOf(buildingId).every((u) => u.sizeSqft) ? 'by_area' : 'equal_units',
      visibleToOwner: true,
      active: true,
      createdBy: adminId,
    };
  };
  const { noor, safa, khan, mamzar, nahda } = ctx.buildings;
  const salaries = 'Building staff salaries (guard, cleaners, technician)';
  const utilities = 'Common-area electricity and water (DEWA / SEWA)';
  const rules: RuleSeed[] = [
    rule(
      noor.id,
      salaries,
      'Al Hamad',
      'رواتب الحارس وعمال النظافة والفني',
      'Guard, cleaners and technician salaries',
      6_500,
      'monthly',
      25,
    ),
    rule(
      safa.id,
      salaries,
      'Al Hamad',
      'راتب الحارس وعاملة النظافة',
      'Guard and cleaner salaries',
      4_200,
      'monthly',
      25,
    ),
    rule(
      khan.id,
      salaries,
      'Al Hamad',
      'رواتب الحارس وعمال النظافة',
      'Guard and cleaners salaries',
      5_800,
      'monthly',
      25,
    ),
    rule(
      mamzar.id,
      salaries,
      'Al Hamad',
      'راتب حارس الفلل المشترك',
      'Shared villa guard salary',
      3_000,
      'monthly',
      25,
    ),
    rule(
      nahda.id,
      salaries,
      'Al Hamad',
      'رواتب الحارس والنظافة',
      'Guard and cleaning salaries',
      4_000,
      'monthly',
      25,
    ),
    rule(
      noor.id,
      utilities,
      'Dubai Electricity',
      'كهرباء ومياه المناطق المشتركة (ديوا)',
      'Common-area electricity and water (DEWA)',
      1_850,
      'monthly',
      15,
    ),
    rule(
      safa.id,
      utilities,
      'Dubai Electricity',
      'كهرباء ومياه المناطق المشتركة (ديوا)',
      'Common-area electricity and water (DEWA)',
      1_200,
      'monthly',
      15,
    ),
    rule(
      khan.id,
      utilities,
      'Sharjah Electricity',
      'كهرباء ومياه المناطق المشتركة (سيوا)',
      'Common-area electricity and water (SEWA)',
      1_600,
      'monthly',
      15,
    ),
    rule(
      mamzar.id,
      utilities,
      'Sharjah Electricity',
      'كهرباء الإنارة الخارجية والري (سيوا)',
      'Outdoor lighting and irrigation (SEWA)',
      900,
      'monthly',
      15,
    ),
    rule(
      nahda.id,
      utilities,
      'Dubai Electricity',
      'كهرباء ومياه المناطق المشتركة (ديوا)',
      'Common-area electricity and water (DEWA)',
      2_400,
      'monthly',
      15,
    ),
    rule(
      noor.id,
      'Lift maintenance contract',
      'Gulf Lifts',
      'عقد صيانة المصاعد (مصعدان)',
      'Lift maintenance contract (two lifts)',
      2_250,
      'quarterly',
      1,
    ),
    rule(
      khan.id,
      'Lift maintenance contract',
      'Gulf Lifts',
      'عقد صيانة المصعد',
      'Lift maintenance contract',
      1_350,
      'quarterly',
      1,
    ),
    rule(
      noor.id,
      'Building insurance',
      'Orient Insurance',
      'وثيقة تأمين المبنى السنوية',
      'Annual building insurance policy',
      18_000,
      'yearly',
      10,
      addMonthsClamped(`${today.slice(0, 4)}-01-10` as PlainDate, -12),
    ),
    rule(
      safa.id,
      'Building insurance',
      'Orient Insurance',
      'وثيقة تأمين المبنى السنوية',
      'Annual building insurance policy',
      9_500,
      'yearly',
      5,
      addMonthsClamped(`${today.slice(0, 4)}-03-05` as PlainDate, -12),
    ),
    rule(
      noor.id,
      'Internet and intercom',
      null,
      'اشتراك الإنترنت والإنتركم',
      'Internet and intercom subscription',
      350,
      'monthly',
      1,
    ),
    rule(
      khan.id,
      'Security and CCTV',
      'Al Hamad',
      'صيانة كاميرات المراقبة',
      'CCTV maintenance',
      450,
      'quarterly',
      20,
    ),
  ];
  await db.insert(s.recurringExpenseRules).values(rules);

  // Expenses -----------------------------------------------------------------------------------
  type ExpenseRow = typeof s.expenses.$inferInsert & { id: string };
  type AllocationRow = typeof s.expenseAllocations.$inferInsert & { id: string };
  const expenseRows: ExpenseRow[] = [];
  const allocationRows: AllocationRow[] = [];
  let invoiceSeq = 1000;

  const allocationUnitsFor = (
    scope: 'building' | 'unit',
    buildingId: string,
    unitId: string | null,
    date: PlainDate,
  ) => {
    const list =
      scope === 'unit' && unitId ? ctx.units.filter((u) => u.id === unitId) : unitsOf(buildingId);
    return list.map((u) => ({
      unitId: u.id,
      sizeSqft: u.sizeSqft,
      owners: ownersOnDate(ctx.ownerships, u.id, date),
    }));
  };

  const addExpense = (
    fields: Omit<
      ExpenseRow,
      'id' | 'totalFils' | 'status' | 'createdBy' | 'createdAt' | 'postedAt' | 'postedBy'
    > & { vatFils: number },
    status: 'draft' | 'posted',
  ): ExpenseRow => {
    const id = uuidv7();
    const totalFils = expenseTotal(fields.amountFils, fields.vatFils);
    const invoiceDate = fields.invoiceDate as PlainDate;
    const row: ExpenseRow = {
      ...fields,
      id,
      totalFils,
      status,
      createdBy: adminId,
      createdAt: new Date(Date.parse(invoiceDate)),
      postedAt: status === 'posted' ? new Date(Date.parse(invoiceDate) + 86_400_000) : null,
      postedBy: status === 'posted' ? adminId : null,
    };
    expenseRows.push(row);
    if (status === 'posted') {
      const parts = allocateExpense(
        totalFils,
        fields.allocationMethod,
        allocationUnitsFor(fields.scope, fields.buildingId, fields.unitId ?? null, invoiceDate),
      );
      for (const p of parts)
        allocationRows.push({
          id: uuidv7(),
          expenseId: id,
          unitId: p.unitId,
          ownerId: p.ownerId,
          amountFils: p.amountFils,
          onDate: invoiceDate,
        });
    }
    return row;
  };

  // Fixed costs from the rules: posted up to three days ago, the latest due dates left as drafts
  // (the queue the cron would have created), nothing in the future.
  for (const r of rules) {
    const due = recurringDueDates(r, { from: since, to: today });
    for (const d of due) {
      const posted = d <= addDays(today, -3);
      invoiceSeq += 1;
      const coversTo = addDays(
        addMonthsClamped(
          `${d.slice(0, 7)}-01` as PlainDate,
          r.frequency === 'monthly' ? 1 : r.frequency === 'quarterly' ? 3 : 12,
        ),
        -1,
      );
      addExpense(
        {
          scope: r.scope,
          buildingId: r.buildingId,
          unitId: r.unitId,
          categoryId: r.categoryId,
          kind: 'fixed',
          vendorId: r.vendorId,
          reasonAr: r.reasonAr,
          reasonEn: r.reasonEn,
          invoiceNo: r.vendorId
            ? `${
                vendorRows
                  .find((v) => v.id === r.vendorId)
                  ?.name.slice(0, 2)
                  .toUpperCase() ?? 'IN'
              }-${d.slice(0, 4)}-${invoiceSeq}`
            : null,
          invoiceDate: d,
          coversFrom: `${d.slice(0, 7)}-01`,
          coversTo,
          amountFils: r.amountFils,
          vatFils: r.vatFils,
          paidOn: posted ? addDays(d, 5) : null,
          paymentMethod: posted ? 'transfer' : null,
          voidReason: null,
          allocationMethod: r.allocationMethod,
          visibleToOwner: true,
          recurringRuleId: r.id,
          disputeId: null,
          correctsExpenseId: null,
          voidedAt: null,
          voidedBy: null,
        },
        posted ? 'posted' : 'draft',
      );
    }
  }

  // Variable costs ---------------------------------------------------------------------------------
  const variable = (
    scope: 'building' | 'unit',
    buildingId: string,
    unitId: string | null,
    categoryEn: string,
    vendorName: string | null,
    reasonAr: string,
    reasonEn: string,
    aed: number,
    date: PlainDate,
    extra: Partial<Pick<ExpenseRow, 'disputeId' | 'paymentMethod' | 'invoiceNo'>> = {},
  ) => {
    const v = vendorName ? vendor(vendorName) : null;
    const amountFils = AED(aed);
    invoiceSeq += 1;
    return addExpense(
      {
        scope,
        buildingId,
        unitId,
        categoryId: cat(categoryEn).id,
        kind: 'variable',
        vendorId: v?.id ?? null,
        reasonAr,
        reasonEn,
        invoiceNo:
          extra.invoiceNo ??
          (v ? `${v.name.slice(0, 2).toUpperCase()}-${date.slice(0, 4)}-${invoiceSeq}` : null),
        invoiceDate: date,
        coversFrom: null,
        coversTo: null,
        amountFils,
        vatFils: v?.trn ? vatFor(amountFils) : 0,
        paidOn: addDays(date, 7),
        paymentMethod: extra.paymentMethod ?? 'transfer',
        voidReason: null,
        allocationMethod:
          scope === 'unit'
            ? 'single_unit'
            : unitsOf(buildingId).every((u) => u.sizeSqft)
              ? 'by_area'
              : 'equal_units',
        visibleToOwner: true,
        recurringRuleId: null,
        disputeId: extra.disputeId ?? null,
        correctsExpenseId: null,
        voidedAt: null,
        voidedBy: null,
      },
      'posted',
    );
  };
  const noor1204 = unit(noor.id, '1204');
  const safa102 = unit(safa.id, '102');
  const nahdaW1 = unit(nahda.id, 'W-1');
  const mamzarV2 = unit(mamzar.id, 'V2');
  const liftRepair = variable(
    'building',
    noor.id,
    null,
    'Lifts (repairs)',
    'Gulf Lifts',
    'إصلاح المصعد رقم 2: استبدال لوحة التحكم والحبال',
    'Lift 2 repair: control board and ropes replaced',
    12_400,
    addMonthsClamped(today, -8),
    { invoiceNo: 'GL-2026-0417' },
  );
  const acRepair = variable(
    'unit',
    safa.id,
    safa102.id,
    'Air conditioning',
    'Cool Breeze',
    'عطل في وحدة التكييف: استبدال الضاغط وتعبئة الغاز',
    'AC breakdown: compressor replaced and gas refilled',
    3_150,
    addMonthsClamped(today, -2),
  );
  const bouncedCase = ctx.disputes.find((d) => d.type === 'bounced_cheque');
  if (bouncedCase) {
    variable(
      'unit',
      ctx.units.find((u) => u.id === bouncedCase.unitId)?.buildingId ?? noor.id,
      bouncedCase.unitId,
      'Legal and court fees',
      'Nasser Legal',
      `رسوم مركز فض المنازعات الإيجارية وأتعاب المحامي للقضية ${bouncedCase.caseNo}`,
      `Rental Dispute Centre fees and lawyer for case ${bouncedCase.caseNo}`,
      4_500,
      addDays(today, -10),
      { disputeId: bouncedCase.id },
    );
  }
  variable(
    'unit',
    khan.id,
    khan302.id,
    'Painting',
    null,
    'دهان كامل للوحدة قبل التأجير',
    'Full repaint before letting',
    2_900,
    addDays(today, -4),
    { paymentMethod: 'cash' },
  );
  variable(
    'unit',
    khan.id,
    unit(khan.id, '301').id,
    'Unit refurbishment before letting',
    'Clean & Shine',
    'تجديد الحمام والمطبخ قبل التأجير',
    'Bathroom and kitchen refurbishment before letting',
    7_800,
    addMonthsClamped(today, -5),
  );
  variable(
    'building',
    khan.id,
    null,
    'Pest control',
    'Clean & Shine',
    'مكافحة الحشرات الدورية للمبنى',
    'Periodic pest control for the building',
    950,
    addMonthsClamped(today, -1),
  );
  variable(
    'unit',
    noor.id,
    noor1204.id,
    'Plumbing',
    null,
    'إصلاح تسريب في مغسلة المطبخ',
    'Kitchen sink leak repaired',
    420,
    addDays(today, -20),
    { paymentMethod: 'cash' },
  );
  variable(
    'unit',
    nahda.id,
    nahdaW1.id,
    'Breakdowns and emergency repairs',
    'Al Hamad',
    'إصلاح طارئ لباب المستودع الكهربائي',
    'Emergency repair of the warehouse roller door',
    2_600,
    addMonthsClamped(today, -4),
  );
  variable(
    'unit',
    mamzar.id,
    mamzarV2.id,
    'Government fees',
    null,
    'رسوم تجديد إيجاري',
    'Ejari renewal fee',
    220,
    addMonthsClamped(today, -3),
    { paymentMethod: 'card' },
  );
  variable(
    'building',
    safa.id,
    null,
    'Deep cleaning',
    'Clean & Shine',
    'تنظيف عميق لخزان المياه والممرات',
    'Deep cleaning of the water tank and corridors',
    1_400,
    addMonthsClamped(today, -7),
  );
  variable(
    'building',
    noor.id,
    null,
    'Electrical',
    'Al Hamad',
    'استبدال إنارة الطوارئ في مواقف السيارات',
    'Emergency lighting replaced in the car park',
    1_850,
    addMonthsClamped(today, -11),
  );
  variable(
    'building',
    nahda.id,
    null,
    'General maintenance',
    'Al Hamad',
    'صيانة مظلات المواقف وإصلاح البوابة',
    'Parking shade maintenance and gate repair',
    3_300,
    addMonthsClamped(today, -14),
  );

  for (let k = 0; k < expenseRows.length; k += 100)
    await db.insert(s.expenses).values(expenseRows.slice(k, k + 100));
  for (let k = 0; k < allocationRows.length; k += 200)
    await db.insert(s.expenseAllocations).values(allocationRows.slice(k, k + 200));

  // Work orders --------------------------------------------------------------------------------------
  const wo = (
    fields: Omit<typeof s.workOrders.$inferInsert, 'id' | 'createdBy'> & { reportedOn: PlainDate },
  ) => ({
    id: uuidv7(),
    createdBy: adminId,
    createdAt: new Date(Date.parse(fields.reportedOn)),
    ...fields,
  });
  const workOrderRows = [
    wo({
      buildingId: noor.id,
      unitId: null,
      titleAr: 'توقف المصعد رقم 2',
      titleEn: 'Lift 2 out of service',
      description: 'توقف المصعد بين الطابقين 12 و13، وأبلغ الحارس عن عطل في لوحة التحكم.',
      priority: 'urgent',
      status: 'done',
      reportedOn: addDays(liftRepair.invoiceDate as PlainDate, -9),
      scheduledFor: addDays(liftRepair.invoiceDate as PlainDate, -7),
      completedAt: new Date(Date.parse(liftRepair.invoiceDate)),
      vendorId: vendor('Gulf Lifts').id,
      expenseId: liftRepair.id,
      visibleToOwner: true,
    }),
    wo({
      buildingId: safa.id,
      unitId: safa102.id,
      titleAr: 'عطل في التكييف',
      titleEn: 'AC not cooling',
      description: 'أبلغ المستأجر أن مكيف الصالة يخرج هواءً ساخناً، والسبب عطل في الضاغط.',
      priority: 'urgent',
      status: 'done',
      reportedOn: addDays(acRepair.invoiceDate as PlainDate, -3),
      scheduledFor: addDays(acRepair.invoiceDate as PlainDate, -2),
      completedAt: new Date(Date.parse(acRepair.invoiceDate)),
      vendorId: vendor('Cool Breeze').id,
      expenseId: acRepair.id,
      visibleToOwner: true,
    }),
    wo({
      buildingId: khan.id,
      unitId: khan302.id,
      titleAr: 'تجديد الوحدة قبل التأجير',
      titleEn: 'Refurbishment before letting',
      description: 'دهان كامل، وتبديل تجهيزات الحمامات وأبواب خزائن المطبخ.',
      priority: 'normal',
      status: 'in_progress',
      reportedOn: addDays(today, -6),
      scheduledFor: addDays(today, -5),
      completedAt: null,
      vendorId: vendor('Clean & Shine').id,
      expenseId: null,
      visibleToOwner: true,
    }),
    wo({
      buildingId: noor.id,
      unitId: null,
      titleAr: 'الفحص السنوي لنظام الإطفاء',
      titleEn: 'Annual fire system inspection',
      description: 'فحص الدفاع المدني السنوي لرشاشات الإطفاء وأجهزة الإنذار.',
      priority: 'normal',
      status: 'scheduled',
      reportedOn: addDays(today, -2),
      scheduledFor: addDays(today, 10),
      completedAt: null,
      vendorId: vendor('Al Hamad').id,
      expenseId: null,
      visibleToOwner: true,
    }),
    wo({
      buildingId: mamzar.id,
      unitId: unit(mamzar.id, 'V3').id,
      titleAr: 'مضخة ري الحديقة لا تعمل',
      titleEn: 'Garden irrigation pump not working',
      description: '',
      priority: 'low',
      status: 'scheduled',
      reportedOn: addDays(today, -1),
      scheduledFor: addDays(today, 2),
      completedAt: null,
      vendorId: null,
      expenseId: null,
      visibleToOwner: true,
    }),
    wo({
      buildingId: safa.id,
      unitId: null,
      titleAr: 'إعادة دهان ممر الطابق الثالث',
      titleEn: 'Repaint third-floor corridor',
      description: 'خدوش على الجدران بعد خروج المستأجر.',
      priority: 'low',
      status: 'open',
      reportedOn: today,
      scheduledFor: null,
      completedAt: null,
      vendorId: null,
      expenseId: null,
      visibleToOwner: true,
    }),
    wo({
      buildingId: noor.id,
      unitId: unit(noor.id, '1502').id,
      titleAr: 'الإنتركم لا يعمل',
      titleEn: 'Intercom not working',
      description: 'بلاغ مكرر لبلاغ سابق، وقام الفني بتبديل السماعة.',
      priority: 'low',
      status: 'cancelled',
      reportedOn: addDays(today, -40),
      scheduledFor: null,
      completedAt: null,
      vendorId: null,
      expenseId: null,
      visibleToOwner: false,
    }),
  ];
  // Large jobs carry an estimate: the refurbishment (already approved, so it is under way) and the
  // fire system inspection, still waiting for the Al Noor owners.
  const refurbishment = workOrderRows[2];
  const fireInspection = workOrderRows[3];
  if (refurbishment) refurbishment.estimateFils = AED(12_000);
  if (fireInspection) fireInspection.estimateFils = AED(18_500);
  await db.insert(s.workOrders).values(workOrderRows);

  // Owner approvals: one row per owner with their share of the estimate on the day asked.
  const approvalRows: (typeof s.repairApprovals.$inferInsert)[] = [];
  const ask = (
    job: (typeof workOrderRows)[number] | undefined,
    askedOn: PlainDate,
    answer: { status: 'approved'; note: string; answeredOn: PlainDate } | null,
  ) => {
    if (!job?.estimateFils) return;
    const scope = job.unitId ? 'unit' : 'building';
    const units = allocationUnitsFor(scope, job.buildingId, job.unitId ?? null, askedOn);
    const method: AllocationMethod =
      scope === 'unit' ? 'single_unit' : units.every((u) => u.sizeSqft) ? 'by_area' : 'equal_units';
    const shares = new Map<string, number>();
    for (const p of allocateExpense(job.estimateFils, method, units))
      shares.set(p.ownerId, (shares.get(p.ownerId) ?? 0) + p.amountFils);
    for (const [ownerId, shareFils] of shares)
      approvalRows.push({
        id: uuidv7(),
        workOrderId: job.id,
        ownerId,
        amountFils: job.estimateFils,
        shareFils,
        status: answer ? answer.status : 'pending',
        note: answer?.note ?? null,
        askedOn,
        answeredAt: answer ? new Date(`${answer.answeredOn}T10:30:00+04:00`) : null,
        createdAt: new Date(`${askedOn}T09:00:00+04:00`),
      });
  };
  ask(refurbishment, addDays(today, -6), {
    status: 'approved',
    note: 'موافق، أرجو إرسال صور الوحدة بعد الانتهاء.',
    answeredOn: addDays(today, -5),
  });
  ask(fireInspection, addDays(today, -1), null);
  if (approvalRows.length) await db.insert(s.repairApprovals).values(approvalRows);

  // Disputes: the cheques behind the bounced-cheque case. The hearing dates are set with the cases
  // (on working days), so the "hearing set" update and the case always agree.
  if (bouncedCase?.contractId) {
    const bounced = ctx.cheques.filter(
      (q) => q.contractId === bouncedCase.contractId && q.status === 'bounced',
    );
    if (bounced.length)
      await db
        .insert(s.disputeCheques)
        .values(bounced.map((q) => ({ disputeId: bouncedCase.id, chequeId: q.id })));
  }

  // Calendar events ----------------------------------------------------------------------------------
  const at = (date: PlainDate, hh: number, mm = 0) =>
    new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+04:00`);
  const eventRows = [
    {
      id: uuidv7(),
      titleAr: 'معاينة سنوية للمبنى مع المالك',
      titleEn: 'Annual building inspection with the owner',
      startsAt: at(addDays(today, 8), 10),
      endsAt: at(addDays(today, 8), 11, 30),
      allDay: false,
      type: 'inspection' as const,
      buildingId: noor.id,
      unitId: null,
      ownerId: ctx.owners.khalid.id,
      visibleToOwner: true,
      notes: 'جولة في المناطق المشتركة والسطح مع السيد خالد.',
      createdBy: adminId,
    },
    {
      id: uuidv7(),
      titleAr: 'تسليم الوحدة 202 للمستأجر الجديد',
      titleEn: 'Handover of unit 202 to the new tenant',
      startsAt: at(addDays(today, 30), 9),
      endsAt: at(addDays(today, 30), 10),
      allDay: false,
      type: 'handover' as const,
      buildingId: safa.id,
      unitId: safa202.id,
      ownerId: null,
      visibleToOwner: true,
      notes: '',
      createdBy: adminId,
    },
    {
      id: uuidv7(),
      titleAr: 'اجتماع جمعية الملاك',
      titleEn: "Owners' association meeting",
      startsAt: at(addDays(today, 15), 18),
      endsAt: at(addDays(today, 15), 19, 30),
      allDay: false,
      type: 'meeting' as const,
      buildingId: khan.id,
      unitId: null,
      ownerId: null,
      visibleToOwner: true,
      notes: 'مناقشة ميزانية رسوم الخدمات للعام القادم.',
      createdBy: adminId,
    },
    {
      id: uuidv7(),
      titleAr: 'تجديد وثيقة تأمين برج النور',
      titleEn: 'Renew Al Noor Tower insurance policy',
      startsAt: at(addDays(today, 45), 0),
      endsAt: at(addDays(today, 45), 23, 59),
      allDay: true,
      type: 'reminder' as const,
      buildingId: noor.id,
      unitId: null,
      ownerId: null,
      visibleToOwner: false,
      notes: 'تذكير داخلي لفريق العمليات.',
      createdBy: adminId,
    },
    {
      id: uuidv7(),
      titleAr: 'زيارة مندوب البلدية',
      titleEn: 'Municipality inspector visit',
      startsAt: at(addDays(today, 3), 11),
      endsAt: at(addDays(today, 3), 12),
      allDay: false,
      type: 'inspection' as const,
      buildingId: nahda.id,
      unitId: null,
      ownerId: null,
      visibleToOwner: false,
      notes: '',
      createdBy: adminId,
    },
  ];
  await db.insert(s.calendarEvents).values(eventRows);

  // Attachments: before and after photos of the AC job and the lift invoice. Bytes go wherever the
  // caller stores files; the rows are written either way so the shape is the same everywhere.
  const acOrder = workOrderRows[1];
  const attachmentRows: (typeof s.attachments.$inferInsert & { id: string; bytes: Uint8Array })[] =
    [];
  const addFile = (
    entityType: 'expense' | 'work_order',
    entityId: string,
    name: string,
    b64: string,
  ) => {
    const bytes = base64ToBytes(b64);
    attachmentRows.push({
      id: uuidv7(),
      entityType,
      entityId,
      r2Key: `${entityType}/${entityId}/${uuidv7()}.jpeg`,
      mime: 'image/jpeg',
      sizeBytes: bytes.byteLength,
      fileName: name,
      uploadedBy: adminId,
      bytes,
    });
  };
  if (acOrder) {
    addFile('work_order', acOrder.id, 'ac-before.jpg', demoImages.before);
    addFile('work_order', acOrder.id, 'ac-after.jpg', demoImages.after);
  }
  addFile('expense', liftRepair.id, 'invoice-GL-2026-0417.jpg', demoImages.invoice);
  addFile('expense', acRepair.id, 'invoice-cool-breeze.jpg', demoImages.invoice);
  await db.insert(s.attachments).values(attachmentRows.map(({ bytes: _b, ...row }) => row));
  if (ctx.files) for (const a of attachmentRows) await ctx.files(a.r2Key, a.bytes, a.mime);

  return {
    vendors: vendorRows.length,
    recurringRules: rules.length,
    expenses: expenseRows.length,
    postedExpenses: expenseRows.filter((e) => e.status === 'posted').length,
    allocations: allocationRows.length,
    workOrders: workOrderRows.length,
    calendarEvents: eventRows.length,
    attachments: attachmentRows.length,
  };
}
