import type { Waiver } from '@/types';

export interface SignaturePoint {
  x: number;
  y: number;
}

export type SignatureStroke = SignaturePoint[];

/** True if someone born on `dob` is under 18 on `on` (local calendar dates). */
export function isUnder18(dob: Date, on: Date = new Date()): boolean {
  const eighteenth = new Date(dob.getFullYear() + 18, dob.getMonth(), dob.getDate());
  const today = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  return eighteenth > today;
}

/** Local calendar date as YYYY-MM-DD (for Postgres `date` columns). */
export function toISODate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Parse a Postgres `date` (YYYY-MM-DD) as a local calendar date. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The account holder's own waiver, if they've signed one. */
export function findAdultWaiver(waivers: Waiver[]): Waiver | undefined {
  return waivers.find((w) => w.child_id === null);
}

export function findChildWaiver(waivers: Waiver[], childId: string): Waiver | undefined {
  return waivers.find((w) => w.child_id === childId);
}

/** Why a child can't be added with these details, or null if they're fine. */
export function newChildError(fullName: string, dob: Date | null, on: Date = new Date()): string | null {
  if (!fullName.trim()) return "Please enter the child's full name.";
  if (!dob) return "Please select the child's date of birth.";
  const today = new Date(on.getFullYear(), on.getMonth(), on.getDate());
  if (dob >= today) return 'Date of birth must be in the past.';
  if (!isUnder18(dob, on)) return 'Children must be under 18. Anyone 18 or over needs their own account.';
  return null;
}

export function formatUKDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

const round = (n: number) => Math.round(n * 10) / 10;

/** SVG path data for one stroke. A single tap becomes a dot via a zero-length line. */
export function strokeToPath(stroke: SignatureStroke): string {
  if (stroke.length === 0) return '';
  const [first, ...rest] = stroke;
  const tail = rest.length > 0 ? rest : [first];
  return `M${round(first.x)} ${round(first.y)}` + tail.map((p) => `L${round(p.x)} ${round(p.y)}`).join('');
}

/** Self-contained SVG document for a drawn signature, or null if nothing was drawn. */
export function buildSignatureSvg(strokes: SignatureStroke[], width: number, height: number): string | null {
  const d = strokes.filter((s) => s.length > 0).map(strokeToPath).join('');
  if (!d) return null;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(width)} ${Math.round(height)}">` +
    `<path d="${d}" fill="none" stroke="#000" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`
  );
}
