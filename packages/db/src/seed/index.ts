/**
 * Demo data: realistic Arabic/English owners, Dubai and Sharjah buildings, tenants, a full
 * year of contracts and cheques in mixed statuses, vacant units and two disputes.
 *
 * Dates are relative to "today" in Dubai so the seed always has cheques due this month,
 * next month and in the past, whatever day it runs. Pass a fixed `today` for tests.
 */
import {
  addDays,
  addMonthsClamped,
  generateChequeSchedule,
  suggestEqualAmounts,
  todayInDubai,
  type ChequeStatus,
  type PlainDate,
} from '@vamar/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as s from '../schema/index.js';
import { uuidv7 } from '../schema/_common.js';

// Any drizzle Postgres database over our schema (node-postgres locally, neon in deploy scripts).
export type SeedDb = PgDatabase<PgQueryResultHKT, typeof s> | NodePgDatabase<typeof s>;

/**
 * Firebase test phone numbers. Configure these in the Firebase console (Authentication >
 * Sign-in method > Phone > Phone numbers for testing) with the codes below; the Auth emulator
 * accepts any code it prints. Also used by the App Store reviewer demo account.
 */
export const DEMO_OWNERS = [
  {
    phone: '+971500000001',
    code: '123456',
    nameEn: 'Khalid Al Mansoori',
    nameAr: 'خالد المنصوري',
    lang: 'ar',
  },
  {
    phone: '+971500000002',
    code: '123456',
    nameEn: 'Fatima Al Suwaidi',
    nameAr: 'فاطمة السويدي',
    lang: 'ar',
  },
  { phone: '+971500000003', code: '123456', nameEn: 'Omar Haddad', nameAr: 'عمر حداد', lang: 'en' },
  {
    phone: '+971500000004',
    code: '123456',
    nameEn: 'Mariam Al Qasimi',
    nameAr: 'مريم القاسمي',
    lang: 'ar',
  },
  {
    phone: '+971500000005',
    code: '123456',
    nameEn: 'Rashid Bin Touq',
    nameAr: 'راشد بن طوق',
    lang: 'en',
  },
] as const;

/** Two dashboard users, as agreed with the client: one admin and one data-entry employee. */
export const DEMO_STAFF = [
  {
    email: 'admin@vamar.test',
    name: 'Salem Al Marri',
    role: 'admin',
    firebaseUid: 'seed-staff-admin',
  },
  {
    email: 'entry@vamar.test',
    name: 'Noura Al Hammadi',
    role: 'editor',
    firebaseUid: 'seed-staff-entry',
  },
] as const;

export interface SeedSummary {
  staff: number;
  owners: number;
  buildings: number;
  units: number;
  tenants: number;
  contracts: number;
  cheques: number;
  disputes: number;
}

const AED = (aed: number) => aed * 100;

// Deterministic pseudo-random so the seed is stable across runs on the same date.
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1_103_515_245 + 12_345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

const BANKS = ['Emirates NBD', 'ADCB', 'Mashreq', 'FAB', 'Dubai Islamic Bank', 'RAKBANK'];

export async function seed(db: SeedDb, today: PlainDate = todayInDubai()): Promise<SeedSummary> {
  const rand = rng(20_261_007);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)] as T;

  // Staff ---------------------------------------------------------------------------------
  const staffRows = DEMO_STAFF.map((st) => ({
    id: uuidv7(),
    ...st,
    totpEnabled: false,
    active: true,
  }));
  await db.insert(s.staffUsers).values(staffRows);
  const admin = staffRows[0];
  if (!admin) throw new Error('seed: no admin');

  // Owners --------------------------------------------------------------------------------
  const ownerRows = DEMO_OWNERS.map((o) => ({
    id: uuidv7(),
    nameAr: o.nameAr,
    nameEn: o.nameEn,
    phoneE164: o.phone,
    email: null,
    preferredLang: o.lang,
    status: 'active' as const,
    createdBy: admin.id,
  }));
  await db.insert(s.owners).values(ownerRows);
  const [khalid, fatima, omar, mariam, rashid] = ownerRows as [
    (typeof ownerRows)[number],
    (typeof ownerRows)[number],
    (typeof ownerRows)[number],
    (typeof ownerRows)[number],
    (typeof ownerRows)[number],
  ];

  // Buildings -----------------------------------------------------------------------------
  const buildingRows = [
    {
      id: uuidv7(),
      nameAr: 'برج النور',
      nameEn: 'Al Noor Tower',
      area: 'Business Bay, Dubai',
      address: 'Marasi Drive, Business Bay',
    },
    {
      id: uuidv7(),
      nameAr: 'بناية الصفا',
      nameEn: 'Al Safa Building',
      area: 'Al Barsha, Dubai',
      address: 'Al Barsha 1, near Mall of the Emirates',
    },
    {
      id: uuidv7(),
      nameAr: 'مجمع الخان',
      nameEn: 'Al Khan Residence',
      area: 'Al Khan, Sharjah',
      address: 'Al Khan Corniche Street',
    },
    {
      id: uuidv7(),
      nameAr: 'فلل الممزر',
      nameEn: 'Mamzar Villas',
      area: 'Al Mamzar, Sharjah',
      address: 'Al Mamzar, Street 12',
    },
    {
      id: uuidv7(),
      nameAr: 'مركز النهدة التجاري',
      nameEn: 'Al Nahda Commercial Centre',
      area: 'Al Nahda, Dubai',
      address: 'Al Nahda 2, Amman Street',
    },
  ];
  await db.insert(s.buildings).values(buildingRows.map((b) => ({ ...b, notes: '' })));
  const [noor, safa, khan, mamzar, nahda] = buildingRows as [
    (typeof buildingRows)[number],
    (typeof buildingRows)[number],
    (typeof buildingRows)[number],
    (typeof buildingRows)[number],
    (typeof buildingRows)[number],
  ];

  // Units ---------------------------------------------------------------------------------
  interface UnitSeed {
    id: string;
    buildingId: string;
    unitNo: string;
    type: (typeof s.unitType.enumValues)[number];
    bedrooms: number | null;
    sizeSqft: number | null;
  }
  const unitRows: UnitSeed[] = [];
  const addUnit = (
    b: { id: string },
    unitNo: string,
    type: UnitSeed['type'],
    bedrooms: number | null,
    sizeSqft: number | null,
  ) => {
    const u: UnitSeed = { id: uuidv7(), buildingId: b.id, unitNo, type, bedrooms, sizeSqft };
    unitRows.push(u);
    return u;
  };
  // Al Noor Tower: 8 apartments
  const noorUnits = ['801', '802', '1204', '1205', '1501', '1502', '2001', '2002'].map((no, i) =>
    addUnit(noor, no, 'apartment', i % 3 === 0 ? 1 : 2, 850 + (i % 3) * 300),
  );
  // Al Safa: 6 apartments
  const safaUnits = ['101', '102', '201', '202', '301', '302'].map((no, i) =>
    addUnit(safa, no, 'apartment', i % 2 === 0 ? 2 : 3, 1200 + (i % 2) * 400),
  );
  // Al Khan Residence: 6 apartments + 2 shops
  const khanUnits = ['G-01', 'G-02', '101', '102', '201', '202', '301', '302'].map((no, i) =>
    i < 2 ? addUnit(khan, no, 'shop', null, 600) : addUnit(khan, no, 'apartment', 2, 1100),
  );
  // Mamzar Villas: 4 villas
  const mamzarUnits = ['V1', 'V2', 'V3', 'V4'].map((no) => addUnit(mamzar, no, 'villa', 4, 3200));
  // Al Nahda Commercial: 4 offices, 2 warehouses
  const nahdaUnits = ['O-201', 'O-202', 'O-301', 'O-302', 'W-1', 'W-2'].map((no, i) =>
    i < 4 ? addUnit(nahda, no, 'office', null, 950) : addUnit(nahda, no, 'warehouse', null, 4500),
  );
  await db.insert(s.units).values(unitRows.map((u) => ({ ...u, active: true })));

  // Ownership -----------------------------------------------------------------------------
  const from: PlainDate = '2022-01-01';
  const ownerships: { unitId: string; ownerId: string; shareBp: number }[] = [];
  const own = (units: UnitSeed[], shares: { owner: { id: string }; bp: number }[]) => {
    for (const u of units)
      for (const sh of shares)
        ownerships.push({ unitId: u.id, ownerId: sh.owner.id, shareBp: sh.bp });
  };
  own(noorUnits, [{ owner: khalid, bp: 10_000 }]);
  own(safaUnits.slice(0, 4), [{ owner: fatima, bp: 10_000 }]);
  // Shared ownership: Fatima 60 %, Omar 40 % on two Safa units
  own(safaUnits.slice(4), [
    { owner: fatima, bp: 6_000 },
    { owner: omar, bp: 4_000 },
  ]);
  own(khanUnits, [{ owner: mariam, bp: 10_000 }]);
  // Three-way split on the villas: 50 / 30 / 20
  own(mamzarUnits, [
    { owner: rashid, bp: 5_000 },
    { owner: khalid, bp: 3_000 },
    { owner: omar, bp: 2_000 },
  ]);
  own(nahdaUnits, [{ owner: omar, bp: 10_000 }]);
  await db
    .insert(s.unitOwnerships)
    .values(ownerships.map((o) => ({ id: uuidv7(), ...o, fromDate: from, toDate: null })));

  // Tenants -------------------------------------------------------------------------------
  const tenantNames = [
    ['Ahmed Saeed', '+971521000001', null],
    ['Priya Nair', '+971521000002', null],
    ['Mohammed Al Hammadi', '+971521000003', null],
    ['Sara Khalil', '+971521000004', null],
    ['John Mitchell', '+971521000005', null],
    ['Aisha Al Zaabi', '+971521000006', null],
    ['Tariq Hussain', '+971521000007', null],
    ['Lina Mansour', '+971521000008', null],
    ['Blue Palm Trading LLC', '+97142000001', 'Blue Palm Trading LLC'],
    ['Gulf Bright Pharmacy', '+97165000002', 'Gulf Bright Pharmacy LLC'],
    ['Nadia Farouk', '+971521000009', null],
    ['Yusuf Karim', '+971521000010', null],
    ['Hessa Al Ketbi', '+971521000011', null],
    ['Daniel Okafor', '+971521000012', null],
    ['Sunrise Logistics FZE', '+97148000003', 'Sunrise Logistics FZE'],
    ['Atlas Design Studio', '+97142000004', 'Atlas Design Studio LLC'],
    ['Huda Al Ali', '+971521000013', null],
    ['Rami Darwish', '+971521000014', null],
    ['Elena Petrova', '+971521000015', null],
    ['Faisal Al Shamsi', '+971521000016', null],
    ['Noor Abbas', '+971521000017', null],
    ['Majid Al Nuaimi', '+971521000018', null],
    ['Khan Brothers General Trading', '+97165000005', 'Khan Brothers General Trading LLC'],
    ['Reem Al Marzouqi', '+971521000019', null],
  ] as const;
  const tenantRows = tenantNames.map(([name, phone, company]) => ({
    id: uuidv7(),
    name,
    phone,
    email: null,
    company,
    notes: '',
  }));
  await db.insert(s.tenants).values(tenantRows);

  // Contracts and cheques -----------------------------------------------------------------
  // Leave these units vacant: two never rented, two with a past contract only.
  const neverRented = new Set([noorUnits[7]?.id, nahdaUnits[5]?.id]);
  const vacatedUnits = new Set([safaUnits[3]?.id, khanUnits[7]?.id]);

  type ContractRow = typeof s.contracts.$inferInsert & {
    id: string;
    startDate: PlainDate;
    endDate: PlainDate;
  };
  type ChequeRow = typeof s.cheques.$inferInsert & {
    id: string;
    contractId: string;
    dueDate: PlainDate;
  };
  type EventRow = typeof s.chequeEvents.$inferInsert & { id: string };
  const contractRows: ContractRow[] = [];
  const chequeRows: ChequeRow[] = [];
  const eventRows: EventRow[] = [];

  const rentFor = (u: UnitSeed): number => {
    switch (u.type) {
      case 'villa':
        return AED(185_000 + Math.floor(rand() * 4) * 10_000);
      case 'shop':
        return AED(95_000 + Math.floor(rand() * 3) * 5_000);
      case 'office':
        return AED(60_000 + Math.floor(rand() * 4) * 5_000);
      case 'warehouse':
        return AED(140_000);
      case 'apartment':
      case 'other':
        return AED(
          (u.bedrooms === 1 ? 55_000 : u.bedrooms === 2 ? 78_000 : 105_000) +
            Math.floor(rand() * 5) * 2_000,
        );
    }
  };

  // Status based on where the due date falls relative to today, with a few deliberate bounces.
  const statusFor = (
    dueDate: PlainDate,
    seq: number,
    chequeCount: number,
    bounceSeq: number | null,
  ): ChequeStatus => {
    if (seq === bounceSeq) return 'bounced';
    const ago = (-1 * (Date.parse(dueDate) - Date.parse(today))) / 86_400_000; // days since due
    if (ago < 0) return 'upcoming';
    if (ago < 7) return 'deposited';
    if (chequeCount === 1 && ago > 300) return 'cleared';
    return 'cleared';
  };

  let tenantIdx = 0;
  const nextTenant = () => {
    const t = tenantRows[tenantIdx % tenantRows.length];
    tenantIdx += 1;
    if (!t) throw new Error('seed: tenant missing');
    return t;
  };

  const monthsAgoStart = (months: number): PlainDate => addMonthsClamped(today, -months);

  let bounceBudget = 3;
  const addContract = (
    unit: UnitSeed,
    startDate: PlainDate,
    chequeCount: number,
    status: 'active' | 'expired' | 'draft',
    opts: { previousContractId?: string | undefined; bounce?: boolean | undefined } = {},
  ): ContractRow => {
    const endDate = addDays(addMonthsClamped(startDate, 12), -1);
    const annualRentFils = rentFor(unit);
    const tenant = nextTenant();
    const contract: ContractRow = {
      id: uuidv7(),
      unitId: unit.id,
      tenantId: tenant.id,
      startDate,
      endDate,
      annualRentFils,
      chequeCount,
      status,
      previousContractId: opts.previousContractId ?? null,
      ejariNo: status === 'draft' ? null : `${Math.floor(1_000_000 + rand() * 8_999_999)}`,
      notes: '',
      createdBy: admin.id,
    };
    contractRows.push(contract);

    const schedule = generateChequeSchedule({ startDate, endDate, chequeCount });
    const amounts = suggestEqualAmounts(annualRentFils, chequeCount);
    const bank = pick(BANKS);
    const bounceSeq =
      opts.bounce && bounceBudget > 0 && status === 'active'
        ? (() => {
            bounceBudget -= 1;
            // the most recent past-due cheque
            const past = schedule.filter((c) => c.dueDate <= today);
            return past.length ? (past[past.length - 1]?.seq ?? null) : null;
          })()
        : null;

    for (const sc of schedule) {
      const draft = status === 'draft';
      const chequeStatus: ChequeStatus = draft
        ? 'upcoming'
        : status === 'expired'
          ? 'cleared'
          : statusFor(sc.dueDate, sc.seq, chequeCount, bounceSeq);
      const amountFils = draft && sc.seq > 1 ? null : (amounts[sc.seq - 1] ?? null);
      const chequeId = uuidv7();
      const changedAt = new Date(Date.parse(sc.dueDate) + 2 * 86_400_000);
      chequeRows.push({
        id: chequeId,
        contractId: contract.id,
        seq: sc.seq,
        dueDate: sc.dueDate,
        amountFils,
        chequeNo: draft && sc.seq > 1 ? null : `${Math.floor(100_000 + rand() * 899_999)}`,
        bankName: draft && sc.seq > 1 ? null : bank,
        status: chequeStatus,
        statusChangedAt: chequeStatus === 'upcoming' ? new Date(Date.parse(startDate)) : changedAt,
        depositedAt: ['deposited', 'cleared', 'bounced'].includes(chequeStatus)
          ? new Date(Date.parse(sc.dueDate))
          : null,
        clearedAt: chequeStatus === 'cleared' ? changedAt : null,
        bouncedAt: chequeStatus === 'bounced' ? changedAt : null,
        bounceReason: chequeStatus === 'bounced' ? 'Insufficient funds' : null,
        replacesChequeId: null,
        imageKey: null,
      });
      // Timeline events for anything past "upcoming"
      if (chequeStatus !== 'upcoming') {
        eventRows.push({
          id: uuidv7(),
          chequeId,
          fromStatus: null,
          toStatus: 'upcoming',
          note: '',
          actorStaffId: admin.id,
          at: new Date(Date.parse(startDate)),
        });
        eventRows.push({
          id: uuidv7(),
          chequeId,
          fromStatus: 'upcoming',
          toStatus: 'deposited',
          note: '',
          actorStaffId: admin.id,
          at: new Date(Date.parse(sc.dueDate)),
        });
        if (chequeStatus !== 'deposited') {
          eventRows.push({
            id: uuidv7(),
            chequeId,
            fromStatus: 'deposited',
            toStatus: chequeStatus,
            note: chequeStatus === 'bounced' ? 'Insufficient funds' : '',
            actorStaffId: admin.id,
            at: changedAt,
          });
        }
      }
    }
    return contract;
  };

  const allUnits = [...noorUnits, ...safaUnits, ...khanUnits, ...mamzarUnits, ...nahdaUnits];
  const chequeCounts = [1, 2, 4, 4, 4, 6, 12, 3];
  let i = 0;
  for (const unit of allUnits) {
    if (neverRented.has(unit.id)) continue;
    if (vacatedUnits.has(unit.id)) {
      // Past contract that expired a few months ago; unit is vacant since then.
      addContract(unit, monthsAgoStart(16 + (i % 3)), 4, 'expired');
      i += 1;
      continue;
    }
    // Active contract that started 1..11 months ago so cheques fall across the year.
    const startedMonthsAgo = 1 + (i % 11);
    const n = chequeCounts[i % chequeCounts.length] ?? 4;
    addContract(unit, monthsAgoStart(startedMonthsAgo), n, 'active', { bounce: i % 7 === 3 });
    i += 1;
  }

  // One contract ending within 60 days with a renewal draft already prepared (one-click renew demo).
  const renewUnit = noorUnits[0];
  if (renewUnit) {
    const old = addContract(renewUnit, addDays(addMonthsClamped(today, -11), -15), 4, 'active');
    // Replace: that unit already got an active contract above; mark the earlier one expired to keep one active per unit.
    const earlier = contractRows.find((c) => c.unitId === renewUnit.id && c.id !== old.id);
    if (earlier) {
      earlier.status = 'expired';
      earlier.startDate = addMonthsClamped(old.startDate, -12);
      earlier.endDate = addDays(old.startDate, -1);
      for (const ch of chequeRows.filter((c) => c.contractId === earlier.id)) {
        ch.dueDate = addMonthsClamped(ch.dueDate, -12);
        ch.status = 'cleared';
        ch.clearedAt = new Date(Date.parse(ch.dueDate) + 2 * 86_400_000);
        ch.bouncedAt = null;
        ch.bounceReason = null;
      }
    }
    addContract(renewUnit, addDays(old.endDate, 1), 4, 'draft', { previousContractId: old.id });
  }

  await db.insert(s.contracts).values(contractRows);
  for (let k = 0; k < chequeRows.length; k += 100)
    await db.insert(s.cheques).values(chequeRows.slice(k, k + 100));
  for (let k = 0; k < eventRows.length; k += 200)
    await db.insert(s.chequeEvents).values(eventRows.slice(k, k + 200));

  // Disputes ------------------------------------------------------------------------------
  const year = Number(today.slice(0, 4));
  const bouncedCheque = chequeRows.find((c) => c.status === 'bounced');
  const bouncedContract = bouncedCheque
    ? contractRows.find((c) => c.id === bouncedCheque.contractId)
    : undefined;
  const arrearsContract = contractRows.find(
    (c) => c.status === 'active' && c.unitId === khanUnits[0]?.id,
  );
  type DisputeRow = typeof s.disputes.$inferInsert & { id: string };
  const disputeRows: DisputeRow[] = [];
  if (bouncedContract) {
    disputeRows.push({
      id: uuidv7(),
      caseNo: `D-${year}-0001`,
      unitId: bouncedContract.unitId,
      contractId: bouncedContract.id,
      tenantId: bouncedContract.tenantId,
      type: 'bounced_cheque',
      amountClaimedFils: bouncedCheque?.amountFils ?? null,
      status: 'in_progress',
      nextHearingDate: addDays(today, 21),
      openedAt: new Date(Date.parse(addDays(today, -12))),
      closedAt: null,
      notes: 'Tenant was notified twice by phone; legal notice sent via Rental Dispute Centre.',
      createdBy: admin.id,
    });
  }
  if (arrearsContract) {
    disputeRows.push({
      id: uuidv7(),
      caseNo: `D-${year}-0002`,
      unitId: arrearsContract.unitId,
      contractId: arrearsContract.id,
      tenantId: arrearsContract.tenantId,
      type: 'rent_arrears',
      amountClaimedFils: AED(23_750),
      status: 'hearing_scheduled',
      nextHearingDate: addDays(today, 9),
      openedAt: new Date(Date.parse(addDays(today, -40))),
      closedAt: null,
      notes: 'Partial payment received in cash; remaining balance disputed by tenant.',
      createdBy: admin.id,
    });
  }
  if (disputeRows.length) {
    await db.insert(s.disputes).values(disputeRows);
    await db.insert(s.disputeCounters).values({ year, last: disputeRows.length });
    const updates: (typeof s.disputeUpdates.$inferInsert)[] = [];
    for (const d of disputeRows) {
      updates.push({
        id: uuidv7(),
        disputeId: d.id,
        note: 'تم فتح القضية وإرسال إشعار قانوني للمستأجر.',
        visibleToOwner: true,
        actorStaffId: admin.id,
        at: d.openedAt ?? new Date(),
      });
      updates.push({
        id: uuidv7(),
        disputeId: d.id,
        note: 'Internal: awaiting RDC case number.',
        visibleToOwner: false,
        actorStaffId: admin.id,
        at: new Date(),
      });
      if (d.nextHearingDate) {
        updates.push({
          id: uuidv7(),
          disputeId: d.id,
          note: `تم تحديد جلسة بتاريخ ${d.nextHearingDate}.`,
          visibleToOwner: true,
          actorStaffId: admin.id,
          at: new Date(),
        });
      }
    }
    await db.insert(s.disputeUpdates).values(updates);
  }

  // Audit trail for the seed itself -------------------------------------------------------
  await db.insert(s.auditLog).values({
    id: uuidv7(),
    actorType: 'system',
    actorId: null,
    action: 'seed.run',
    entityType: 'database',
    entityId: null,
    before: null,
    after: { today, owners: ownerRows.length, contracts: contractRows.length },
    ip: null,
    userAgent: 'seed-script',
  });

  return {
    staff: staffRows.length,
    owners: ownerRows.length,
    buildings: buildingRows.length,
    units: unitRows.length,
    tenants: tenantRows.length,
    contracts: contractRows.length,
    cheques: chequeRows.length,
    disputes: disputeRows.length,
  };
}
