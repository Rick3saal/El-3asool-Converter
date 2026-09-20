/**
 * Booking-class (RBD) letter → cabin resolution.
 *
 * Itineraries printed in Sabre/GDS style carry a single class letter per
 * flight ("EY 22 W 14DEC YYZ AUH …"). The letter's meaning is AIRLINE-SPECIFIC:
 * W is Business on Emirates but Economy on others, J is First on American,
 * Business on most European carriers, and so on.
 *
 * Priority in the converter:
 *   1. cabin word printed in the source ("Business", "First", …)
 *   2. this letter → cabin map (deterministic, offline), incl. equip-scoped rows
 *   3. learned carrier+flight knowledge from the user's own corrections
 *   4. the user's manual fallback cabin choice
 *
 * Letters that are ambiguous or airline-dependent are deliberately NOT mapped:
 * an unknown letter falls through to the manual choice instead of guessing
 * the wrong cabin. The maps below only contain letters that are documented,
 * stable and well-attested for each carrier, plus rows explicitly approved by
 * the owner of this tool (marked "approved").
 */
import type { Cabin } from "./types";

type LetterMap = Record<string, Cabin>;

/** Emirates — GDS-verified class families (W = Business Saver/Value, etc.) */
const EY: LetterMap = {
  // First
  F: "FIRST",
  A: "FIRST",
  R: "FIRST",
  P: "FIRST",
  // Business
  J: "BUSINESS",
  C: "BUSINESS",
  W: "BUSINESS",
  D: "BUSINESS",
  I: "BUSINESS",
  O: "BUSINESS",
  H: "BUSINESS",
  // Economy
  Y: "ECONOMY",
  E: "ECONOMY",
  M: "ECONOMY",
  B: "ECONOMY",
  U: "ECONOMY",
  K: "ECONOMY",
  Q: "ECONOMY",
  L: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
  N: "ECONOMY",
  G: "ECONOMY",
  S: "ECONOMY",
};

/** British Airways */
const BA: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  W: "BUSINESS",
  I: "BUSINESS",
  D: "BUSINESS",
  C: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  N: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  X: "ECONOMY",
  V: "ECONOMY",
};

/** Lufthansa Group (LH, LX, OE, SN, LS, CO) */
const LH: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  I: "BUSINESS",
  Y: "ECONOMY",
  M: "ECONOMY",
  B: "ECONOMY",
  H: "ECONOMY",
  L: "ECONOMY",
  K: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  X: "ECONOMY",
  V: "ECONOMY",
  G: "ECONOMY",
  N: "ECONOMY",
};

/** Air France–KLM (AF, KL, HP, VS, EZ, VY) */
const AF: LetterMap = {
  F: "FIRST",
  I: "BUSINESS",
  C: "BUSINESS",
  J: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  N: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
};

/** Qatar Airways */
const QR: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  I: "BUSINESS",
  D: "BUSINESS",
  O: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  N: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
};

/** Singapore Airlines */
const SQ: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  D: "BUSINESS",
  I: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  N: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
  Z: "ECONOMY",
  E: "ECONOMY",
  U: "ECONOMY",
};

/** EgyptAir */
const MS: LetterMap = {
  F: "FIRST",
  A: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  I: "BUSINESS",
  D: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
};

/** Turkish Airlines */
const TK: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  I: "BUSINESS",
  D: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
  N: "ECONOMY",
  G: "ECONOMY",
};

/** Cathay Pacific */
const CX: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  D: "BUSINESS",
  I: "BUSINESS",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  L: "ECONOMY",
  K: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
  E: "ECONOMY",
};

/** Alaska Airlines (approved: D=FIRST, I/J FIRST on 737/E75; I on 787-9 is
 *  BUSINESS — see the equip-scoped rows below) */
const AS: LetterMap = {
  D: "FIRST",
  I: "FIRST",
  J: "FIRST",
};

/** American Airlines (approved rows) */
const AA: LetterMap = {
  F: "FIRST",
  A: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  D: "BUSINESS",
  R: "BUSINESS",
  I: "BUSINESS",
  P: "PREMIUM",
  W: "PREMIUM",
  B: "ECONOMY",
  Y: "ECONOMY",
};

/** Delta Air Lines (approved rows: P/A/G = Premium Select) */
const DL: LetterMap = {
  P: "PREMIUM",
  A: "PREMIUM",
  G: "PREMIUM",
};

/** Air Canada (approved: P = BUSINESS on AC — overrides the industry default;
 *  Z/N/A are Premium Economy) */
const AC: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  D: "BUSINESS",
  P: "BUSINESS",
  Z: "PREMIUM",
  N: "PREMIUM",
  A: "PREMIUM",
  Y: "ECONOMY",
  B: "ECONOMY",
  M: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  V: "ECONOMY",
  X: "ECONOMY",
};

/** Japan Airlines / ANA style (JL, NH, QR-ish Asia-Pacific) */
const JL: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  C: "BUSINESS",
  I: "BUSINESS",
  D: "BUSINESS",
  Y: "ECONOMY",
  M: "ECONOMY",
  B: "ECONOMY",
  H: "ECONOMY",
  K: "ECONOMY",
  L: "ECONOMY",
  Q: "ECONOMY",
  S: "ECONOMY",
  T: "ECONOMY",
  X: "ECONOMY",
  V: "ECONOMY",
  G: "ECONOMY",
};

const AIRLINE_MAPS: Record<string, LetterMap> = {
  EY,
  BA,
  IB: BA,
  LH,
  LX: LH,
  OE: LH,
  SN: LH,
  LS: LH,
  CO: LH,
  AF,
  KL: AF,
  HP: AF,
  VS: AF,
  QR,
  SQ,
  MS,
  TK,
  CX,
  AC,
  JL,
  NH: JL,
  AS,
  AA,
  DL,
};

/** Equipment-scoped overrides, checked BEFORE the normal map row when the
 *  segment's equipment is known (approved: AS "I" is BUSINESS on the 787-9
 *  but FIRST on 737/E75 metal). Families are Sabre equipment codes. */
const SCOPED_ROWS: Array<{ airline: string; letter: string; cabin: Cabin; families: string[] }> = [
  { airline: "AS", letter: "I", cabin: "BUSINESS", families: ["789"] },
];

/**
 * Letters that are (nearly) universal across the industry and safe to apply
 * when no airline-specific map exists. Deliberately tiny: F, J and Y are the
 * only ones that are unambiguous on virtually every carrier.
 */
const GENERIC: LetterMap = {
  F: "FIRST",
  J: "BUSINESS",
  Y: "ECONOMY",
};

/**
 * Resolve a booking-class letter to a cabin for the given marketing carrier.
 * `equip` (Sabre equipment code, when known) refines equip-scoped rows first.
 * Returns null when the letter is unknown/ambiguous — callers must NOT guess
 * in that case (the user chooses the cabin manually instead).
 */
export function cabinFromBookingClass(
  airline: string,
  cls: string | undefined | null,
  equip?: string
): Cabin | null {
  if (!cls) return null;
  const letter = String(cls).trim().toUpperCase();
  if (!/^[A-Z]$/.test(letter)) return null;
  const al = (airline || "").toUpperCase();
  if (equip) {
    const scoped = SCOPED_ROWS.find(
      (r) => r.airline === al && r.letter === letter && r.families.includes(equip)
    );
    if (scoped) return scoped.cabin;
  }
  return (AIRLINE_MAPS[al] && AIRLINE_MAPS[al][letter]) || GENERIC[letter] || null;
}
