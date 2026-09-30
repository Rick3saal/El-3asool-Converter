/**
 * Calendar helpers shared by every reading path.
 *
 * Itinerary sources print day + month only, so the whole app works on a fixed
 * 365-day calendar model (no leap day, no year). Every module that shifts a
 * date must use these helpers so "21OCT + 1 day" means the same thing in the
 * generic parser, the Google-Flights reader and the converter.
 */
import type { ParsedDate, RawFlight } from "./types";

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** day-of-year index (1..365) on the shared calendar model */
export function doy(d: ParsedDate): number {
  let s = 0;
  for (let i = 0; i < d.month - 1; i++) s += MONTH_DAYS[i];
  return s + d.day;
}

/**
 * Add (or, with a negative n, subtract) whole days from a day/month pair.
 * `raw` is intentionally dropped: a shifted date no longer matches the text
 * that was printed in the source, and Sabre formatting prefers `raw` verbatim.
 */
export function addDays(d: ParsedDate, n: number): ParsedDate {
  let day = d.day;
  let month = d.month;
  for (let i = 0; i < n; i++) {
    day += 1;
    if (day > MONTH_DAYS[month - 1]) {
      day = 1;
      month = month === 12 ? 1 : month + 1;
    }
  }
  for (let i = 0; i > n; i--) {
    day -= 1;
    if (day < 1) {
      month = month === 1 ? 12 : month - 1;
      day = MONTH_DAYS[month - 1];
    }
  }
  return { day, month };
}

export function dateGapDays(a: ParsedDate | undefined, b: ParsedDate | undefined): number | null {
  if (!a || !b) return null;
  let diff = doy(b) - doy(a);
  // Circular year wrap: itineraries often cross Dec/Jan or span several months
  // across a year boundary (e.g. Oct → Feb the next year). Take the forward gap
  // in both directions and pick the one that represents a forward-moving trip.
  // A forward gap of -244 days (Oct 28 → Feb 26) really means +121 days.
  if (diff < 0) {
    const wrapped = diff + 365;
    // Use wrapped when it's the natural interpretation: b is after a across a
    // year boundary. Keep small negative gaps (negative meaning same-day wrap
    // such as date misorder) so they still look like small/negative gaps.
    if (wrapped <= 185) diff = wrapped;
  } else if (diff > 185) {
    // More than ~6 months forward is almost certainly backwards across a year
    // boundary; keep it as negative so it never looks like the "largest gap".
    diff -= 365;
  }
  return diff;
}

export function sameDate(a: ParsedDate | undefined, b: ParsedDate | undefined): boolean {
  return !!a && !!b && a.day === b.day && a.month === b.month;
}

/** one connection whose departure date had to be rolled forward */
export interface ConnectionDateFix {
  flight: RawFlight;
  /** the leg it connects from */
  prev: RawFlight;
  /** the day the previous leg lands */
  landsOn: ParsedDate;
  from: ParsedDate;
  to: ParsedDate;
  days: number;
}

/**
 * A connecting flight can never depart before the flight it connects from has
 * landed. Sources print the journey date once per card ("LAX → BOM / Wed, Mar
 * 17") and each leg only prints clock times, so a leg that follows an overnight
 * leg keeps inheriting the card date and lands a day early:
 *
 *   BA 1509  17MAR  LAX LHR  725P 105P¥1     <- lands 18MAR
 *   BA 135   17MAR  LHR BOM  305P 540A¥1     <- impossible: departs before it lands
 *
 * This walks the legs in order and pushes such a departure date forward by the
 * whole number of days needed to make the connection non-negative (so the leg
 * above becomes 18MAR). Legs that already read correctly are never touched, and
 * a date is only ever moved forward, never backwards.
 *
 * A leg whose own date is printed in the source (`dateExplicit`) is left alone:
 * what the source states about a leg always beats what can be inferred from its
 * neighbour — some itineraries legitimately land on the same calendar day they
 * departed (a date-line crossing reads as an arrival "before" the departure).
 *
 * Runs on every path (text parser, Style C reader, AI extraction, learned
 * memory) because it is a property of the itinerary, not of one source format.
 */
export function enforceConnectionDates(flights: RawFlight[]): ConnectionDateFix[] {
  const fixes: ConnectionDateFix[] = [];
  for (let i = 1; i < flights.length; i++) {
    const prev = flights[i - 1];
    const cur = flights[i];
    if (!prev.date || !cur.date) continue;
    if (cur.dateExplicit) continue;
    if (prev.dep === undefined || prev.arr === undefined || cur.dep === undefined) continue;
    // only within one journey, and only for a real connection
    if ((prev.direction ?? "OUT") !== (cur.direction ?? "OUT")) continue;
    if (!prev.dest || !cur.origin || prev.dest !== cur.origin) continue;

    const gap = dateGapDays(prev.date, cur.date);
    if (gap === null) continue;
    // minutes between the previous arrival and this departure
    const connection = (gap - (prev.arrDay ?? 0)) * 1440 + cur.dep - prev.arr;
    if (connection >= 0) continue;

    const days = Math.ceil(-connection / 1440);
    // Guard against a runaway shift from a badly-read pair of legs.
    if (days < 1 || days > 3) continue;
    const from = cur.date;
    const to = addDays(cur.date, days);
    cur.date = to;
    fixes.push({
      flight: cur,
      prev,
      landsOn: addDays(prev.date, prev.arrDay ?? 0),
      from,
      to,
      days,
    });
  }
  return fixes;
}
