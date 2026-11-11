import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  bankCsvMappingSchema,
  chequeNoKey,
  chequeNumbersInText,
  detectHeaderRow,
  isBounceDescription,
  matchStatement,
  MAX_BULK_CHEQUES,
  normaliseDigits,
  parseBankCsvMappings,
  parseDirection,
  parseStatement,
  parseStatementAmount,
  parseStatementDate,
  planStatementApply,
  upsertBankCsvMapping,
  WEAK_MATCH_DAYS,
  type BankCsvMapping,
  type CandidateCheque,
  type StatementLine,
} from './bank-statement.js';
import { addDays, fromEpochDays, toEpochDays, type PlainDate } from './dates.js';

const toArabicIndic = (s: string) =>
  s.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));

describe('normaliseDigits / chequeNoKey', () => {
  it('turns both Arabic digit sets into ASCII', () => {
    expect(normaliseDigits('١٢٣٫٤٥')).toBe('123.45');
    expect(normaliseDigits('۰۱۲')).toBe('012');
  });

  it('reduces cheque numbers to their digits without leading zeros', () => {
    expect(chequeNoKey('000123')).toBe('123');
    expect(chequeNoKey('CHQ 123')).toBe('123');
    expect(chequeNoKey('٠٠١٢٣')).toBe('123');
    expect(chequeNoKey('0000')).toBeNull();
    expect(chequeNoKey('')).toBeNull();
    expect(chequeNoKey(null)).toBeNull();
  });

  it('finds cheque-sized numbers inside a description', () => {
    expect(chequeNumbersInText('CLG CHQ NO 000456 FROM ENBD 12')).toEqual(['456']);
    expect(chequeNumbersInText('no numbers')).toEqual([]);
  });
});

describe('parseStatementAmount', () => {
  it('reads the ways banks write amounts', () => {
    expect(parseStatementAmount('1,234.56')).toBe(123_456);
    expect(parseStatementAmount('1234')).toBe(123_400);
    expect(parseStatementAmount('1234.5')).toBe(123_450);
    expect(parseStatementAmount('-1,234.56')).toBe(-123_456);
    expect(parseStatementAmount('−1,234.56')).toBe(-123_456);
    expect(parseStatementAmount('(1,234.56)')).toBe(-123_456);
    expect(parseStatementAmount('1,234.56-')).toBe(-123_456);
    expect(parseStatementAmount('1,234.56 DR')).toBe(-123_456);
    expect(parseStatementAmount('1,234.56CR')).toBe(123_456);
    expect(parseStatementAmount('+50')).toBe(5_000);
    expect(parseStatementAmount('AED 12,500.00')).toBe(1_250_000);
    expect(parseStatementAmount('١٢٬٥٠٠٫٠٠ درهم')).toBe(1_250_000);
    expect(parseStatementAmount('1 250.00')).toBe(125_000);
    expect(parseStatementAmount('1234.500')).toBe(123_450);
    expect(parseStatementAmount('0.00')).toBe(0);
  });

  it('returns null for blanks and things that are not money', () => {
    for (const bad of ['', ' ', '-', 'abc', '1.234,56', '12.345', '1.2.3', null, undefined])
      expect(parseStatementAmount(bad), String(bad)).toBeNull();
  });

  it('property: any fils amount survives formatting with separators and either digit set', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 99_999_999_999 }),
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom('', 'AED ', ' DR', 'neg', 'paren'),
        (fils, grouped, arabic, wrap) => {
          const whole = Math.floor(fils / 100);
          const frac = String(fils % 100).padStart(2, '0');
          let text = `${grouped ? whole.toLocaleString('en-US') : String(whole)}.${frac}`;
          if (arabic) text = toArabicIndic(text).replace('.', '٫').replace(/,/g, '٬');
          let expected = fils;
          if (wrap === 'AED ') text = `AED ${text}`;
          if (wrap === ' DR') text = `${text} DR`;
          if (wrap === 'neg') text = `-${text}`;
          if (wrap === 'paren') text = `(${text})`;
          if (wrap === ' DR' || wrap === 'neg' || wrap === 'paren')
            expected = fils === 0 ? 0 : -fils;
          expect(parseStatementAmount(text)).toBe(expected);
        },
      ),
    );
  });
});

describe('parseDirection', () => {
  it('reads CR/DR style indicators in both languages', () => {
    expect(parseDirection('CR')).toBe('credit');
    expect(parseDirection(' credit ')).toBe('credit');
    expect(parseDirection('دائن')).toBe('credit');
    expect(parseDirection('DR')).toBe('debit');
    expect(parseDirection('d')).toBe('debit');
    expect(parseDirection('مدين')).toBe('debit');
    expect(parseDirection('')).toBeNull();
    expect(parseDirection('maybe')).toBeNull();
    expect(parseDirection(undefined)).toBeNull();
  });
});

describe('parseStatementDate', () => {
  it('reads dd/mm/yyyy, yyyy-mm-dd and dd-MMM-yyyy', () => {
    expect(parseStatementDate('03/11/2026')).toBe('2026-11-03');
    expect(parseStatementDate('3/11/2026')).toBe('2026-11-03');
    expect(parseStatementDate('03-11-2026')).toBe('2026-11-03');
    expect(parseStatementDate('03.11.2026 14:22')).toBe('2026-11-03');
    expect(parseStatementDate('2026-11-03')).toBe('2026-11-03');
    expect(parseStatementDate('2026/11/03')).toBe('2026-11-03');
    expect(parseStatementDate('2026-11-03 09:00:00')).toBe('2026-11-03');
    expect(parseStatementDate('03-Nov-2026')).toBe('2026-11-03');
    expect(parseStatementDate('03 NOV 2026')).toBe('2026-11-03');
    expect(parseStatementDate('3-November-26')).toBe('2026-11-03');
    expect(parseStatementDate('03-Sept-2026')).toBe('2026-09-03');
    expect(parseStatementDate('٠٣/١١/٢٠٢٦')).toBe('2026-11-03');
    expect(parseStatementDate('03 نوفمبر 2026')).toBe('2026-11-03');
  });

  it('turns a zoned timestamp into its Dubai date', () => {
    // 21:30 UTC is 01:30 the next morning in Dubai.
    expect(parseStatementDate('2026-11-03T21:30:00Z')).toBe('2026-11-04');
    expect(parseStatementDate('2026-11-03T10:00:00+04:00')).toBe('2026-11-03');
  });

  it('rejects impossible or unknown dates', () => {
    for (const bad of [
      '',
      '31/02/2026',
      '2026-13-01',
      '00/01/2026',
      '03-Foo-2026',
      'yesterday',
      '11/2026',
      null,
    ])
      expect(parseStatementDate(bad), String(bad)).toBeNull();
  });

  it('property: every calendar date round-trips through all three layouts', () => {
    const MON = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
    fc.assert(
      fc.property(
        fc.integer({ min: toEpochDays('2000-01-01'), max: toEpochDays('2099-12-31') }),
        (n) => {
          const d = fromEpochDays(n);
          const [y, m, day] = d.split('-');
          expect(parseStatementDate(`${day}/${m}/${y}`)).toBe(d);
          expect(parseStatementDate(d)).toBe(d);
          expect(parseStatementDate(`${day}-${MON[Number(m) - 1]}-${y}`)).toBe(d);
        },
      ),
    );
  });
});

describe('isBounceDescription', () => {
  it('spots return wording in English and Arabic', () => {
    for (const yes of [
      'CHQ RETURN 000123',
      'RETURNED CHEQUE',
      'RTN CHQ 456',
      'Cheque bounced - insufficient funds',
      'شيك مرتجع',
      'ارتجاع شيك',
    ])
      expect(isBounceDescription(yes), yes).toBe(true);
    for (const no of ['CLEARING CHQ 123', 'RETURNING CUSTOMER BONUS', 'TRTNX 55', '', null])
      expect(isBounceDescription(no), String(no)).toBe(false);
  });
});

describe('mappings', () => {
  const enbd: BankCsvMapping = bankCsvMappingSchema.parse({
    bank: 'ENBD',
    dateColumn: 'Date',
    amountColumn: 'Amount',
  });

  it('defaults the optional columns to null and rejects duplicate bank names', () => {
    expect(enbd.chequeNoColumn).toBeNull();
    expect(parseBankCsvMappings([enbd, { ...enbd, bank: 'enbd' }])).toEqual([]);
    expect(parseBankCsvMappings('garbage')).toEqual([]);
    expect(parseBankCsvMappings([enbd])).toEqual([enbd]);
  });

  it('upserts by bank name without case and keeps the list sorted', () => {
    const adcb = { ...enbd, bank: 'ADCB' };
    const list = upsertBankCsvMapping([enbd], adcb);
    expect(list.map((m) => m.bank)).toEqual(['ADCB', 'ENBD']);
    const replaced = upsertBankCsvMapping(list, {
      ...enbd,
      bank: 'enbd',
      dateColumn: 'Value Date',
    });
    expect(replaced.map((m) => m.bank)).toEqual(['ADCB', 'enbd']);
    expect(replaced[1]?.dateColumn).toBe('Value Date');
  });
});

describe('detectHeaderRow / parseStatement', () => {
  const grid = [
    ['Emirates NBD', '', '', '', ''],
    ['Account', '1012345678', '', '', ''],
    ['', '', '', '', ''],
    ['Txn Date', 'Description', 'Cheque No', 'Amount', 'Dr/Cr'],
    ['03/11/2026', 'CLG CHQ', '000101', '12,500.00', 'CR'],
    ['04-Nov-2026', 'CHQ RETURN', '000202', '15,000.00', 'DR'],
    ['', '', '', '', ''],
    ['bad', 'Opening balance', '', '', ''],
    ['05/11/2026', 'Fee', '', 'n/a', 'DR'],
    ['05/11/2026', 'Zero', '', '0.00', 'CR'],
    ['2026-11-06', 'TRANSFER', '', '٣٬٠٠٠٫٠٠', 'DR'],
  ];
  const mapping = bankCsvMappingSchema.parse({
    bank: 'ENBD',
    dateColumn: 'txn date',
    amountColumn: 'Amount',
    chequeNoColumn: 'Cheque No',
    descriptionColumn: 'Description',
    signColumn: 'Dr/Cr',
  });

  it('finds the table below the account details', () => {
    expect(detectHeaderRow(grid)).toBe(3);
    expect(detectHeaderRow([])).toBe(0);
    expect(detectHeaderRow([['only one']])).toBe(0);
  });

  it('reads lines with a CR/DR column and reports what it skipped', () => {
    const r = parseStatement(grid, mapping);
    expect(r.missingColumns).toEqual([]);
    expect(r.lines).toEqual([
      {
        row: 5,
        date: '2026-11-03',
        amountFils: 1_250_000,
        direction: 'credit',
        chequeNo: '000101',
        description: 'CLG CHQ',
        bounce: false,
      },
      {
        row: 6,
        date: '2026-11-04',
        amountFils: 1_500_000,
        direction: 'debit',
        chequeNo: '000202',
        description: 'CHQ RETURN',
        bounce: true,
      },
      {
        row: 11,
        date: '2026-11-06',
        amountFils: 300_000,
        direction: 'debit',
        chequeNo: null,
        description: 'TRANSFER',
        bounce: false,
      },
    ]);
    expect(r.skipped).toEqual([
      { row: 8, reason: 'bad_date' },
      { row: 9, reason: 'bad_amount' },
      { row: 10, reason: 'zero_amount' },
    ]);
  });

  it('reads separate debit and credit columns, and signed amounts', () => {
    const split = [
      ['Date', 'Narrative', 'Debit', 'Credit'],
      ['03/11/2026', 'CHQ 000101', '', '12,500.00'],
      ['04/11/2026', 'RTN CHQ 000202', '15,000.00', ''],
      ['04/11/2026', 'nothing', '', ''],
    ];
    const r = parseStatement(
      split,
      bankCsvMappingSchema.parse({
        bank: 'ADCB',
        dateColumn: 'Date',
        amountColumn: 'Credit',
        debitColumn: 'Debit',
        descriptionColumn: 'Narrative',
      }),
    );
    expect(r.lines.map((l) => [l.direction, l.amountFils, l.bounce])).toEqual([
      ['credit', 1_250_000, false],
      ['debit', 1_500_000, true],
    ]);
    expect(r.skipped).toEqual([{ row: 4, reason: 'bad_amount' }]);

    const signed = parseStatement(
      [
        ['Date', 'Amount'],
        ['03/11/2026', '-10.00'],
        ['03/11/2026', '10.00'],
      ],
      bankCsvMappingSchema.parse({ bank: 'X', dateColumn: 'Date', amountColumn: 'Amount' }),
    );
    expect(signed.lines.map((l) => l.direction)).toEqual(['debit', 'credit']);
  });

  it('names the mapped columns the file does not have', () => {
    const r = parseStatement(grid, { ...mapping, chequeNoColumn: 'Chq', signColumn: 'Sign' });
    expect(r.missingColumns).toEqual(['Chq', 'Sign']);
    expect(r.lines).toEqual([]);
  });
});

// Matching -------------------------------------------------------------------------------------

function line(p: Partial<StatementLine> = {}): StatementLine {
  return {
    row: 2,
    date: '2026-11-03',
    amountFils: 1_250_000,
    direction: 'credit',
    chequeNo: null,
    description: '',
    bounce: false,
    ...p,
  };
}

function cheque(p: Partial<CandidateCheque> = {}): CandidateCheque {
  return {
    id: 'c1',
    chequeNo: '000101',
    amountFils: 1_250_000,
    dueDate: '2026-11-01',
    status: 'deposited',
    depositedOn: '2026-11-01',
    ...p,
  };
}

describe('matchStatement', () => {
  it('number + amount is a strong clear; leading zeros and Arabic digits do not matter', () => {
    const r = matchStatement([line({ chequeNo: '١٠١' })], [cheque()]);
    expect(r.matches).toEqual([
      expect.objectContaining({ chequeId: 'c1', strength: 'strong', action: 'cleared', dayGap: 2 }),
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it('finds the number inside the description when there is no number column', () => {
    const r = matchStatement([line({ description: 'CLG CHQ 000101' })], [cheque()]);
    expect(r.matches[0]?.strength).toBe('strong');
  });

  it('a number with the wrong amount, or a number that is not ours, never falls back to amount', () => {
    expect(
      matchStatement([line({ chequeNo: '101', amountFils: 1 })], [cheque()]).unmatched[0]?.reason,
    ).toBe('no_match');
    expect(matchStatement([line({ chequeNo: '999' })], [cheque()]).unmatched[0]?.reason).toBe(
      'no_match',
    );
  });

  it(`amount + date within ${String(WEAK_MATCH_DAYS)} days without a number is weak`, () => {
    const c = cheque({ status: 'upcoming', depositedOn: null, dueDate: '2026-11-01' });
    expect(matchStatement([line({ date: '2026-11-04' })], [c]).matches[0]).toEqual(
      expect.objectContaining({ strength: 'weak', dayGap: 3 }),
    );
    expect(matchStatement([line({ date: '2026-11-05' })], [c]).unmatched[0]?.reason).toBe(
      'no_match',
    );
    // A deposited cheque also counts from its deposit date.
    const late = cheque({ dueDate: '2026-10-01', depositedOn: '2026-11-02' });
    expect(matchStatement([line({ date: '2026-11-04' })], [late]).matches[0]?.dayGap).toBe(2);
  });

  it('return wording proposes bounced, other debits are ignored', () => {
    const r = matchStatement(
      [
        line({
          row: 2,
          direction: 'debit',
          chequeNo: '101',
          description: 'CHQ RETURN',
          bounce: true,
        }),
        line({ row: 3, direction: 'debit', chequeNo: '101', description: 'SALARY' }),
      ],
      [cheque()],
    );
    expect(r.matches.map((m) => [m.line.row, m.action])).toEqual([[2, 'bounced']]);
    expect(r.unmatched.map((u) => [u.line.row, u.reason])).toEqual([[3, 'debit']]);
  });

  it('a credit followed by its return ends bounced; the credit is reported as already matched', () => {
    const r = matchStatement(
      [
        line({ row: 2, chequeNo: '101' }),
        line({ row: 3, direction: 'debit', chequeNo: '101', bounce: true, description: 'RTN' }),
      ],
      [cheque()],
    );
    expect(r.matches.map((m) => [m.line.row, m.action])).toEqual([[3, 'bounced']]);
    expect(r.unmatched.map((u) => [u.line.row, u.reason])).toEqual([[2, 'already_matched']]);
  });

  it('strong matches claim cheques before weak ones; ties go to the nearest date', () => {
    const a = cheque({ id: 'a', chequeNo: '1001', dueDate: '2026-11-03', depositedOn: null });
    const b = cheque({ id: 'b', chequeNo: '1002', dueDate: '2026-11-02', depositedOn: null });
    const r = matchStatement(
      [line({ row: 2, date: '2026-11-03' }), line({ row: 3, chequeNo: '1001' })],
      [a, b],
    );
    expect(r.matches.map((m) => [m.line.row, m.chequeId, m.strength, m.alternatives])).toEqual([
      [2, 'b', 'weak', 0],
      [3, 'a', 'strong', 0],
    ]);
    const tie = matchStatement([line({ date: '2026-11-03' })], [a, b]);
    expect(tie.matches[0]).toEqual(expect.objectContaining({ chequeId: 'a', alternatives: 1 }));
  });

  it('skips cheques without an amount', () => {
    expect(matchStatement([line()], [cheque({ amountFils: null })]).matches).toEqual([]);
  });

  it('property: each line and each cheque is used at most once, and every match fits its rule', () => {
    const date = fc.integer({ min: 0, max: 20 }).map((n) => addDays('2026-11-01', n) as PlainDate);
    const amount = fc.constantFrom(100_000, 250_000, 1_250_000);
    const no = fc.option(fc.constantFrom('101', '0102', '103', '٠١٠٤'), { nil: null });
    const lineArb = fc.record({
      date,
      amountFils: amount,
      direction: fc.constantFrom('credit' as const, 'debit' as const),
      chequeNo: no,
      bounce: fc.boolean(),
    });
    const chequeArb = fc.record({
      chequeNo: fc.option(fc.constantFrom('101', '102', '103', '104'), { nil: null }),
      amountFils: fc.option(amount, { nil: null }),
      dueDate: date,
      status: fc.constantFrom('upcoming' as const, 'deposited' as const),
      depositedOn: fc.option(date, { nil: null }),
    });
    fc.assert(
      fc.property(
        fc.array(lineArb, { maxLength: 12 }),
        fc.array(chequeArb, { maxLength: 8 }),
        (ls, cs) => {
          const lines = ls.map((l, i) => line({ ...l, row: i + 2, description: '' }));
          const cheques = cs.map((c, i) => cheque({ ...c, id: `c${String(i)}` }));
          const r = matchStatement(lines, cheques);
          expect(r.matches.length + r.unmatched.length).toBe(lines.length);
          expect(new Set(r.matches.map((m) => m.chequeId)).size).toBe(r.matches.length);
          expect(new Set(r.matches.map((m) => m.line.row)).size).toBe(r.matches.length);
          for (const m of r.matches) {
            const c = cheques.find((x) => x.id === m.chequeId);
            expect(c?.amountFils).toBe(m.line.amountFils);
            expect(m.action).toBe(m.line.bounce ? 'bounced' : 'cleared');
            if (m.strength === 'strong')
              expect(chequeNoKey(c?.chequeNo)).toBe(chequeNoKey(m.line.chequeNo));
            else {
              expect(m.line.chequeNo).toBeNull();
              expect(m.dayGap).toBeLessThanOrEqual(WEAK_MATCH_DAYS);
            }
            expect(m.line.direction === 'credit' || m.line.bounce).toBe(true);
          }
        },
      ),
    );
  });
});

describe('planStatementApply', () => {
  it('deposits upcoming cheques first, then clears, then bounces, grouped by date', () => {
    const status = (id: string) =>
      ({ a: 'upcoming', b: 'deposited', c: 'upcoming', d: 'deposited' })[id] as
        'upcoming' | 'deposited' | undefined;
    const steps = planStatementApply(
      [
        { chequeId: 'd', action: 'bounced', date: '2026-11-04' },
        { chequeId: 'a', action: 'cleared', date: '2026-11-03' },
        { chequeId: 'b', action: 'cleared', date: '2026-11-03' },
        { chequeId: 'c', action: 'cleared', date: '2026-11-02' },
      ],
      status,
    );
    expect(steps).toEqual([
      { status: 'deposited', date: '2026-11-02', ids: ['c'] },
      { status: 'deposited', date: '2026-11-03', ids: ['a'] },
      { status: 'cleared', date: '2026-11-02', ids: ['c'] },
      { status: 'cleared', date: '2026-11-03', ids: ['a', 'b'] },
      { status: 'bounced', date: '2026-11-04', ids: ['d'] },
    ]);
  });

  it(`splits a step larger than ${String(MAX_BULK_CHEQUES)} cheques`, () => {
    const many = Array.from({ length: MAX_BULK_CHEQUES + 5 }, (_, i) => ({
      chequeId: `x${String(i)}`,
      action: 'cleared' as const,
      date: '2026-11-03' as PlainDate,
    }));
    const steps = planStatementApply(many, () => 'deposited');
    expect(steps.map((s) => s.ids.length)).toEqual([MAX_BULK_CHEQUES, 5]);
    expect(planStatementApply([], () => 'deposited')).toEqual([]);
  });
});
