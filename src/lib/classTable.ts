/**
 * Airline-specific booking-class → cabin table (Style A support).
 *
 * Rules:
 *  - The table ONLY assigns a cabin from a class letter. It never rewrites
 *    the letter itself — the source's booking class prints exactly as given.
 *  - Style B (verbose text) printed cabins are authoritative: when the source
 *    says "Business (P)" the table is skipped entirely.
 *  - Rows can be scoped to an equipment family (AS "I" is BUSINESS on the
 *    787-9 but FIRST on 737/E75 metal).
 */
import type { Cabin } from "./types";

interface ClassRow {
  cabin: Cabin;
  /** when present, the row only matches this equipment family */
  equipFamilies?: string[][];
}

const B789 = ["789"];
const NARROW_AS = ["737", "738", "739", "73H", "73J", "73G", "E75"];

/** keyed `${AIRLINE}:${LETTER}` */
const CLASS_TABLE: Record<string, ClassRow> = {
  // Alaska
  "AS:D": { cabin: "FIRST" },
  "AS:I": { cabin: "FIRST" }, // default; narrowed by equipFamilies rows below
  "AS:J": { cabin: "FIRST" },
  // Air Canada
  "AC:P": { cabin: "BUSINESS" },
  "AC:J": { cabin: "BUSINESS" },
  "AC:C": { cabin: "BUSINESS" },
  "AC:D": { cabin: "BUSINESS" },
  "AC:Z": { cabin: "BUSINESS" },
  "AC:O": { cabin: "PREMIUM" },
  "AC:E": { cabin: "PREMIUM" },
  "AC:N": { cabin: "PREMIUM" },
  // Etihad
  "EY:W": { cabin: "BUSINESS" },
  "EY:J": { cabin: "BUSINESS" },
  "EY:C": { cabin: "BUSINESS" },
  "EY:D": { cabin: "BUSINESS" },
  // American
  "AA:F": { cabin: "FIRST" },
  "AA:A": { cabin: "FIRST" },
  "AA:J": { cabin: "BUSINESS" },
  "AA:C": { cabin: "BUSINESS" },
  "AA:D": { cabin: "BUSINESS" },
  "AA:R": { cabin: "BUSINESS" },
  "AA:I": { cabin: "BUSINESS" },
  "AA:P": { cabin: "PREMIUM" },
  "AA:W": { cabin: "PREMIUM" },
  "AA:B": { cabin: "ECONOMY" },
  "AA:Y": { cabin: "ECONOMY" },
  // Delta
  "DL:P": { cabin: "PREMIUM" },
  "DL:A": { cabin: "PREMIUM" },
  "DL:G": { cabin: "PREMIUM" },
  "DL:D": { cabin: "FIRST" },
  "DL:I": { cabin: "FIRST" },
  "DL:J": { cabin: "FIRST" },
  "DL:C": { cabin: "FIRST" },
  "DL:Z": { cabin: "FIRST" },
};

/** equipment-scoped overrides, checked before the generic row */
const SCOPED_ROWS: Array<{ key: string; cabin: Cabin; families: string[][]; row?: ClassRow }> = [
  { key: "AS:I", cabin: "BUSINESS", families: [B789] },
  { key: "AS:I", cabin: "FIRST", families: [NARROW_AS] },
  { key: "AS:J", cabin: "FIRST", families: [NARROW_AS] },
];

/**
 * Cabin for a class letter on a carrier, optionally refined by equipment.
 * Returns null when the combination is not in the table — the caller should
 * then ask for / fall back to a user-chosen cabin (never invent a letter).
 */
/** Main-cabin letters meaning ECONOMY on any carrier UNLESS a
 *  carrier-specific row above overrides them (DL:G is PREMIUM, for one). */
const GENERIC_ECONOMY_LETTERS = new Set([
  "Y", "B", "M", "H", "Q", "K", "L", "V", "S", "T", "X", "G", "N", "U", "E",
]);

export function cabinFromClass(airline: string, letter: string, equip?: string): Cabin | null {
  const key = `${airline}:${letter}`;
  if (equip) {
    for (const row of SCOPED_ROWS) {
      if (row.key !== key) continue;
      if (row.families.some((fam) => fam.includes(equip))) return row.cabin;
    }
  }
  const row = CLASS_TABLE[key];
  if (row) return row.cabin;
  if (GENERIC_ECONOMY_LETTERS.has(letter)) return "ECONOMY";
  return null;
}
