import {
  buildSignatureSvg, findAdultWaiver, findChildWaiver, fromISODate, isUnder18, newChildError, strokeToPath, toISODate,
} from '@/lib/waiver';
import type { Waiver } from '@/types';

describe('isUnder18', () => {
  const on = new Date(2026, 9, 28); // 28 Oct 2026

  it('is false on the 18th birthday', () => {
    expect(isUnder18(new Date(2008, 9, 28), on)).toBe(false);
  });

  it('is true the day before the 18th birthday', () => {
    expect(isUnder18(new Date(2008, 9, 29), on)).toBe(true);
  });

  it('is false for adults', () => {
    expect(isUnder18(new Date(1990, 0, 1), on)).toBe(false);
  });

  it('ignores the time of day on the reference date', () => {
    expect(isUnder18(new Date(2008, 9, 28), new Date(2026, 9, 28, 0, 0, 1))).toBe(false);
  });
});

describe('ISO date helpers', () => {
  it('round-trips a local calendar date', () => {
    const d = new Date(2001, 1, 3);
    expect(toISODate(d)).toBe('2001-02-03');
    expect(fromISODate('2001-02-03').getTime()).toBe(d.getTime());
  });
});

describe('signature SVG', () => {
  it('turns a single tap into a dot', () => {
    expect(strokeToPath([{ x: 1, y: 2 }])).toBe('M1 2L1 2');
  });

  it('rounds coordinates to one decimal place', () => {
    expect(strokeToPath([{ x: 1.234, y: 2 }, { x: 3.456, y: 4.04 }])).toBe('M1.2 2L3.5 4');
  });

  it('returns null when nothing was drawn', () => {
    expect(buildSignatureSvg([], 300, 160)).toBeNull();
    expect(buildSignatureSvg([[]], 300, 160)).toBeNull();
  });

  it('builds a standalone svg with the pad dimensions as viewBox', () => {
    const svg = buildSignatureSvg([[{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 5, y: 5 }]], 300.4, 160)!;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 300 160"');
    expect(svg).toContain('d="M0 0L10 10M5 5L5 5"');
  });
});

describe('newChildError', () => {
  const on = new Date(2026, 9, 30);

  it('accepts a named child under 18', () => {
    expect(newChildError('Sam Smith', new Date(2016, 4, 1), on)).toBeNull();
  });

  it('requires a name and date of birth', () => {
    expect(newChildError('  ', new Date(2016, 4, 1), on)).toMatch(/name/);
    expect(newChildError('Sam', null, on)).toMatch(/date of birth/);
  });

  it('rejects today or a future date', () => {
    expect(newChildError('Sam', new Date(2026, 9, 30), on)).toMatch(/past/);
  });

  it('rejects anyone 18 or over', () => {
    expect(newChildError('Sam', new Date(2008, 9, 30), on)).toMatch(/under 18/);
  });
});

describe('waiver lookups', () => {
  const waiver = (child_id: string | null) => ({ id: child_id ?? 'adult', child_id }) as Waiver;
  const waivers = [waiver('c1'), waiver(null), waiver('c2')];

  it('finds the account holder’s own waiver', () => {
    expect(findAdultWaiver(waivers)?.id).toBe('adult');
    expect(findAdultWaiver([waiver('c1')])).toBeUndefined();
  });

  it('finds a child’s waiver', () => {
    expect(findChildWaiver(waivers, 'c2')?.id).toBe('c2');
    expect(findChildWaiver(waivers, 'c3')).toBeUndefined();
  });
});
