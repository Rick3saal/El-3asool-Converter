/**
 * Google Flights / "Style C" itinerary reader — ADDITIVE, opt-in path.
 *
 * This module never replaces the existing deterministic parser. It only runs
 * when the pasted text is recognised as a Google-Flights-style card layout
 * (see `isGoogleFlightsStyleC`) AND it can read every printed flight number
 * into a complete leg. In every other case `parseGoogleFlightsStyleC` returns
 * null and the original generic parser handles the text exactly as before.
 * Matrix / ITA pasted itineraries never reach this module.
 *
 * ── Style C rules implemented here ──────────────────────────────────────────
 *  1. The airline printed on a flight leg is that leg's MARKETING carrier.
 *  2. Every leg is read independently — no carrier is inherited from a
 *     neighbouring leg.
 *  3. An operated-by line is produced ONLY when the source explicitly states
 *     an operator for that flight ("Operated by X", "Operated by X as Y for Z",
 *     "Plane and crew by X as Y"). No external operator lookup is performed.
 *  4. Cabin / booking class are resolved per individual leg.
 *  5. Only a real flight number starts a segment. Airline names, cabins,
 *     aircraft, emissions, seat/Wi-Fi/power/video features, contrail notes and
 *     layovers are supporting information and can never become a segment.
 *  6. Heading route/date (e.g. "BOM → MSP / Wed, Nov 11") establishes itinerary
 *     context; each flight block supplies its own origin/destination and times.
 *     A leg's date is inherited from the heading unless the leg states its own.
 */
import type { Cabin, ParsedDate, RawFlight } from "./types";
import { airlineFromName, isAirlineCode } from "./airlines";
import { parseExplicitAircraftString } from "./aircraft";
import { cleanOperator } from "./operator";

/* ------------------------------------------------------------------ */
/* small date helpers                                                  */
/* ------------------------------------------------------------------ */

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MON_NAME = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** add whole days to a day/month pair (same calendar model the parser uses) */
function addDays(d: ParsedDate, n: number): ParsedDate {
  let day = d.day;
  let month = d.month;
  for (let i = 0; i < n; i++) {
    day += 1;
    if (day > MONTH_DAYS[month - 1]) {
      day = 1;
      month = month === 12 ? 1 : month + 1;
    }
  }
  return { day, month };
}

/* ------------------------------------------------------------------ */
/* line classification                                                 */
/* ------------------------------------------------------------------ */

type GfKind =
  | "OPBY" | "LAYOVER" | "TIMERANGE" | "TIME" | "DATE" | "FLIGHT" | "UNKNOWN_FLIGHT" | "AIRPORT"
  | "ROUTE" | "DURATION" | "CABIN" | "AIRCRAFT" | "AIRLINE" | "OTHER";

interface GfLine {
  idx: number;
  text: string;
  kind: GfKind;
  date?: ParsedDate;
  min?: number;
  dayOffset?: number;
  /** for TIMERANGE: dep/arr minutes and offsets */
  dep?: number;
  arr?: number;
  depOff?: number;
  arrOff?: number;
  airportCode?: string;
  routeCodes?: string[];
  airline?: string;
  number?: string;
  cabin?: Cabin;
  bookingClass?: string;
  operator?: string;
  minutes?: number;
  /** airport line that belongs to a layover block, never a flight endpoint */
  layoverAirport?: boolean;
  /** operated-by line already claimed by a flight */
  used?: boolean;
}

function matchOpbyLine(s: string): string | null {
  const m =
    /^(?:operated\s+by|plane\s+and\s+crew\s+by|plane\s+and\s+crew\s+provided\s+by|aircraft\s+operated\s+by)\b[\s:.\u2013-]*(.+)$/i.exec(
      s
    );
  if (!m) return null;
  return cleanOperator(m[1]);
}

function isLayoverLine(s: string): boolean {
  return /\blayover\b|\bchange\s+of\s+airports?\b|\bchange\s+planes\b|\bconnection\s+in\b|\bself[- ]transfer\b|\boverflight\b/i.test(
    s
  );
}



/** single clock time e.g. "6:00 AM" or "1:20 PM +1" */
function matchTimeLine(s: string): { min: number; dayOffset: number } | null {
  const m = /^(\d{1,2}):(\d{2})\s*(?:([AaPp])\.?\s*[Mm]\.?)?\s*(?:\+\s*(\d))?$/.exec(s);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (mm > 59) return null;
  let min: number;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    min = (h % 12) * 60 + mm + (/p/i.test(m[3]) ? 720 : 0);
  } else {
    if (h > 23) return null;
    min = h * 60 + mm;
  }
  const off = m[4] ? parseInt(m[4], 10) : 0;
  return { min, dayOffset: off === 1 || off === 2 ? off : 0 };
}

/** time range e.g. "2:15 am - 7:05 am" or "6:19 pm - 8:15 pm" with optional +1 on each side.
 *  Separator is dash (–, —, -). Arrow "→" is NOT a time-range separator here so that
 *  Matrix style "10:40 AM → 1:50 PM" does not become a Style-C timerange.
 */
function matchTimeRangeLine(s: string): { dep: number; arr: number; depOff: number; arrOff: number } | null {
  const t = s.trim();
  // strict time-range line: two clocks separated by dash
  // each clock: H:MM [AM/PM] [+N]
  const re = /^(\d{1,2}):(\d{2})\s*([AaPp]\.?[ \t]*[Mm]\.?)?\s*(?:\+\s*(\d))?\s*[-–—]\s*(\d{1,2}):(\d{2})\s*([AaPp]\.?[ \t]*[Mm]\.?)?\s*(?:\+\s*(\d))?\s*$/;
  const m = re.exec(t);
  if (!m) return null;
  const h1 = parseInt(m[1], 10);
  const mm1 = parseInt(m[2], 10);
  const ap1 = m[3] ? /p/i.test(m[3]) : null;
  const off1 = m[4] ? parseInt(m[4], 10) : 0;
  const h2 = parseInt(m[5], 10);
  const mm2 = parseInt(m[6], 10);
  const ap2 = m[7] ? /p/i.test(m[7]) : null;
  const off2 = m[8] ? parseInt(m[8], 10) : 0;
  if (mm1 > 59 || mm2 > 59) return null;
  let dep: number;
  let arr: number;
  // if AM/PM present, validate 1-12; else treat as 24h
  if (ap1 !== null) {
    if (h1 < 1 || h1 > 12) return null;
    dep = (h1 % 12) * 60 + mm1 + (ap1 ? 720 : 0);
  } else {
    if (h1 > 23) return null;
    dep = h1 * 60 + mm1;
  }
  if (ap2 !== null) {
    if (h2 < 1 || h2 > 12) return null;
    arr = (h2 % 12) * 60 + mm2 + (ap2 ? 720 : 0);
  } else {
    if (h2 > 23) return null;
    arr = h2 * 60 + mm2;
  }
  const depOff = off1 === 1 || off1 === 2 ? off1 : 0;
  const arrOff = off2 === 1 || off2 === 2 ? off2 : 0;
  return { dep, arr, depOff, arrOff };
}

function matchDateLine(s: string): ParsedDate | null {
  let m = new RegExp(`(?:^|[^a-z0-9])(${MON_NAME})\\.?[\\s,]+(\\d{1,2})(?:st|nd|rd|th)?(?![0-9])`, "i").exec(s);
  if (m) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const day = parseInt(m[2], 10);
    if (month && day >= 1 && day <= 31) return { day, month };
  }
  m = new RegExp(`(?:^|[^a-z0-9])(\\d{1,2})(?:st|nd|rd|th)?[\\s,]+(${MON_NAME})\\.?(?![a-z0-9])`, "i").exec(s);
  if (m) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const day = parseInt(m[1], 10);
    if (month && day >= 1 && day <= 31) return { day, month };
  }
  return null;
}

function matchFlightLine(s: string): { airline: string; number: string } | null {
  const t = s.replace(/\s+/g, " ").trim();
  // "4Y 81", "LH 2306", "BA 6597" — a space keeps "A330" from ever reading as A3/330
  let m = /^([A-Z0-9]{2})\s+(\d{1,4})$/.exec(t);
  if (m && /[A-Z]/.test(m[1]) && isAirlineCode(m[1])) {
    return { airline: m[1], number: String(parseInt(m[2], 10)) };
  }
  // glued "LH2306" — only when the line is definitely not an aircraft type
  m = /^([A-Z]{2})(\d{2,4})$/.exec(t);
  if (m && isAirlineCode(m[1]) && parseExplicitAircraftString(t) === null) {
    return { airline: m[1], number: String(parseInt(m[2], 10)) };
  }
  // "British Airways 6597", "Akasa Air 585", "Etihad 10"
  m = /^([A-Za-z][A-Za-z .'&\u2019-]{1,40}?)\s*[-\u2013]?\s*(\d{1,4})$/.exec(t);
  if (m) {
    const code = airlineFromName(m[1]);
    if (code) return { airline: code, number: String(parseInt(m[2], 10)) };
  }
  return null;
}

/**
 * A line that is structurally a flight designator but whose carrier is not in
 * the airline table (e.g. a code this build has never seen). Such a line must
 * never be silently ignored — the reader bails out so nothing is dropped.
 */
function looksLikeUnknownFlightLine(s: string): boolean {
  const t = s.replace(/\s+/g, " ").trim();
  const m = /^([A-Z0-9]{2})\s+(\d{1,4})$/.exec(t);
  if (m && /[A-Z]/.test(m[1]) && !isAirlineCode(m[1])) {
    // "A3 30" style aircraft text is excluded by the aircraft mapper
    return parseExplicitAircraftString(t) === null;
  }
  return false;
}

function matchAirportLine(s: string): string | null {
  const m = /^(.*?)\(([A-Z]{3})\)\.?$/.exec(s);
  if (!m) return null;
  const name = m[1].trim();
  if (name.length > 70) return null;
  if (name && !/^[A-Za-z][A-Za-z0-9 .,'\u2019\-/&]*$/.test(name)) return null;
  return m[2];
}

function matchRouteLine(s: string): string[] | null {
  const parts = s
    .split(/\s*(?:\u2192|->|\u21d2|\u279c|\bto\b|\u2013|\u2014|-)\s*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const codes: string[] = [];
  for (const p of parts) {
    const m = /\(([A-Z]{3})\)$/.exec(p) ?? /^([A-Z]{3})$/.exec(p);
    if (!m) return null;
    codes.push(m[1]);
  }
  return codes.length >= 2 ? codes : null;
}

function matchDurationLine(s: string): number | null {
  let m = /^(\d{1,2})\s*(?:hr|hrs|hour|hours|h)\s*(?:(\d{1,2})\s*(?:min|mins|minutes|m))?$/i.exec(s);
  if (m) {
    const h = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : 0;
    if (h <= 30 && mm <= 59) return h * 60 + mm;
    return null;
  }
  m = /^(\d{1,3})\s*(?:min|mins|minutes)$/i.exec(s);
  if (m) {
    const mm = parseInt(m[1], 10);
    if (mm >= 20 && mm <= 1200) return mm;
  }
  return null;
}

function matchCabinLine(s: string): { cabin: Cabin; bookingClass?: string } | null {
  const m =
    /^(?:basic\s+)?(premium\s+economy|premium\s+eco|economy|coach|business|first)(?:\s+class)?(?:\s*[(\[]([A-Z])[)\]])?$/i.exec(
      s.trim()
    );
  if (!m) return null;
  const w = m[1].toLowerCase();
  let cabin: Cabin;
  if (w === "first") cabin = "FIRST";
  else if (w === "business") cabin = "BUSINESS";
  else if (w.startsWith("premium")) cabin = "PREMIUM";
  else cabin = "ECONOMY";
  return { cabin, bookingClass: m[2] ? m[2].toUpperCase() : undefined };
}

function classify(text: string, idx: number): GfLine {
  const base: GfLine = { idx, text, kind: "OTHER" };

  const op = matchOpbyLine(text);
  if (op) return { ...base, kind: "OPBY", operator: op };

  if (isLayoverLine(text)) return { ...base, kind: "LAYOVER" };

  const tr = matchTimeRangeLine(text);
  if (tr) return { ...base, kind: "TIMERANGE", dep: tr.dep, arr: tr.arr, depOff: tr.depOff, arrOff: tr.arrOff };

  const tm = matchTimeLine(text);
  if (tm) return { ...base, kind: "TIME", min: tm.min, dayOffset: tm.dayOffset };

  const dt = matchDateLine(text);
  if (dt) return { ...base, kind: "DATE", date: dt };

  const fl = matchFlightLine(text);
  if (fl) return { ...base, kind: "FLIGHT", airline: fl.airline, number: fl.number };

  if (looksLikeUnknownFlightLine(text)) return { ...base, kind: "UNKNOWN_FLIGHT" };

  const ap = matchAirportLine(text);
  if (ap) return { ...base, kind: "AIRPORT", airportCode: ap };

  const rt = matchRouteLine(text);
  if (rt) return { ...base, kind: "ROUTE", routeCodes: rt };

  const du = matchDurationLine(text);
  if (du !== null) return { ...base, kind: "DURATION", minutes: du };

  const cb = matchCabinLine(text);
  if (cb) return { ...base, kind: "CABIN", cabin: cb.cabin, bookingClass: cb.bookingClass };

  // an aircraft description is supporting info — never a segment
  if (text.length <= 48 && parseExplicitAircraftString(text) !== null) {
    return { ...base, kind: "AIRCRAFT" };
  }

  const al = airlineFromName(text);
  if (al) return { ...base, kind: "AIRLINE", airline: al };

  return base;
}

function toLines(text: string): GfLine[] {
  const out: GfLine[] = [];
  text.split("\n").forEach((raw, i) => {
    const t = raw.replace(/^[\s\u00b7\u2022\u2219]+/, "").trim();
    if (!t) return;
    out.push(classify(t, i));
  });
  // an airport printed directly under a layover line is the connection point,
  // never a flight endpoint
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].kind === "LAYOVER" && out[i + 1].kind === "AIRPORT") {
      out[i + 1].layoverAirport = true;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* detection                                                           */
/* ------------------------------------------------------------------ */

/** Google Flights UI chrome — strings that essentially only that source prints */
const GF_CHROME: RegExp[] = [
  /\bdeparting\s*flight\b/i,
  /\breturn(?:ing)?\s*flight\b/i,
  /\bplane\s+and\s+crew\s+by\b/i,
  /\d+\s*(?:hr|hour)s?(?:\s*\d+\s*min)?\s+layover\b/i,
  /\d+\s*min\s+layover\b/i,
  /\bavg\.?\s+legroom\b/i,
  /\b(?:below|above)\s+average\s+legroom\b/i,
  /\bcarbon\s+emissions\s+estimate\b/i,
  /\bemissions\s+estimate\b/i,
  /\bavg\s+emissions\b/i,
  /\bin[- ]?seat\s+power\b/i,
  /\bstream\s+media\s+to\s+your\s+device\b/i,
  /\bwi-?fi\s+for\s+a\s+fee\b/i,
  /\bcontrail\b/i,
  /\bseparate\s+tickets\s+booked\s+together\b/i,
];

/**
 * True when the pasted text is a Google Flights / Style C card layout.
 *
 * Deliberately strict: at least one piece of Google-Flights UI chrome must be
 * present OR the heading+timerange variant is recognised. Matrix / ITA pastes,
 * Sabre blocks and the "Airline 123 / Aircraft / Cabin" layouts the generic
 * parser already handles never satisfy this, so their behaviour is untouched.
 */
export function isGoogleFlightsStyleC(text: string): boolean {
  const lines = toLines(text);
  const times = lines.filter((l) => l.kind === "TIME").length;
  const timeranges = lines.filter((l) => l.kind === "TIMERANGE").length;
  const flights = lines.filter((l) => l.kind === "FLIGHT").length;
  let chrome = 0;
  for (const re of GF_CHROME) if (re.test(text)) chrome++;
  if (chrome >= 2) return flights >= 1 || times >= 2 || timeranges >= 1;
  if (chrome === 1) return (times >= 2 || timeranges >= 1) && flights >= 1;
  // heading variant: at least one timerange + at least one flight + a date/route heading
  if (timeranges >= 1 && flights >= 1) {
    const hasDate = lines.some((l) => l.kind === "DATE" && !/arriv/i.test(l.text));
    const hasRoute = lines.some((l) => l.kind === "ROUTE");
    if (hasDate || hasRoute) return true;
    // even without header, a pasted Style C with multiple legs and timeranges is recognisable
    if (timeranges >= 2 || flights >= 2) return true;
  }
  if (chrome === 0) return false;
  return times >= 2 && flights >= 1;
}

/* ------------------------------------------------------------------ */
/* parsing                                                             */
/* ------------------------------------------------------------------ */

interface Pair {
  min: number;
  off: number;
  code?: string;
}

/** lines that begin the NEXT leg's description — a forward scan stops there */
function startsNextLeg(k: GfKind): boolean {
  return k === "TIMERANGE" || k === "TIME" || k === "AIRPORT" || k === "ROUTE" || k === "DATE" || k === "LAYOVER" || k === "AIRLINE";
}

/**
 * Read a Google Flights / Style C itinerary.
 *
 * Returns null (no opinion) unless EVERY printed flight number resolves to a
 * complete leg — in that case the caller keeps using the existing parser.
 */
export function parseGoogleFlightsStyleC(text: string): RawFlight[] | null {
  const lines = toLines(text);
  const anchors: number[] = [];
  lines.forEach((l, i) => {
    if (l.kind === "FLIGHT") anchors.push(i);
  });
  if (anchors.length === 0) return null;
  // A designator whose carrier is unknown here would be dropped silently —
  // hand the whole text back to the existing parser instead.
  if (lines.some((l) => l.kind === "UNKNOWN_FLIGHT")) return null;

  // heading route detection: a ROUTE immediately followed by a heading DATE
  // (e.g. "BOM → MSP" / "Wed, Nov 11") is itinerary context, not a per-leg route
  const headerIdx = new Set<number>();
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].kind === "ROUTE" && lines[i + 1].kind === "DATE" && !/arriv/i.test(lines[i + 1].text)) {
      headerIdx.add(i);
    }
  }

  const flights: RawFlight[] = [];
  let journeyDate: ParsedDate | undefined;
  let prevAnchor = -1;

  for (let a = 0; a < anchors.length; a++) {
    const pos = anchors[a];
    const anchor = lines[pos];
    const nextAnchor = a + 1 < anchors.length ? anchors[a + 1] : lines.length;
    const winStart = prevAnchor + 1;

    // ---- first pass: locate the leg's own timerange (if any) ----
    let chosenTimerange: GfLine | undefined;
    let timerangeIdx = -1;
    for (let i = winStart; i < pos; i++) {
      if (lines[i].kind === "TIMERANGE") {
        chosenTimerange = lines[i];
        timerangeIdx = i;
      }
    }
    // collect this leg's own block data, ignoring anything that belongs to the
    // previous leg (which sits before this leg's own timerange)
    let routeCodes: string[] | undefined;
    let cabin: Cabin | undefined;
    let bookingClass: string | undefined;
    let equipRaw: string | undefined;
    let duration: number | undefined;
    let opbyIdx = -1;
    const pairs: Pair[] = [];

    for (let i = winStart; i < pos; i++) {
      const L = lines[i];
      if (L.kind === "DATE" && !/arriv/i.test(L.text)) {
        journeyDate = L.date;
      } else if (L.kind === "TIME") {
        const nxt = lines[i + 1];
        const code = nxt && nxt.kind === "AIRPORT" && !nxt.layoverAirport ? nxt.airportCode : undefined;
        pairs.push({ min: L.min!, off: L.dayOffset ?? 0, code });
        if (code) i++;
      } else if (L.kind === "ROUTE" && !headerIdx.has(i)) {
        // keep the last non-header route before the flight; if a timerange exists,
        // only a route after the timerange belongs to this leg (heading is before)
        if (chosenTimerange && i < timerangeIdx) continue;
        routeCodes = L.routeCodes;
      } else if (L.kind === "CABIN") {
        if (chosenTimerange && i < timerangeIdx) continue; // previous leg's cabin
        cabin = L.cabin;
        if (L.bookingClass) bookingClass = L.bookingClass;
      } else if (L.kind === "AIRCRAFT") {
        if (chosenTimerange && i < timerangeIdx) continue;
        equipRaw = L.text;
      } else if (L.kind === "DURATION") {
        if (chosenTimerange && i < timerangeIdx) continue;
        duration = L.minutes;
      } else if (L.kind === "OPBY" && !L.used) {
        if (chosenTimerange && i < timerangeIdx) continue;
        opbyIdx = i;
      }
    }

    /* ---- trailing details printed under the flight number ---- */
    for (let i = pos + 1; i < nextAnchor; i++) {
      const L = lines[i];
      if (startsNextLeg(L.kind)) break;
      if (L.kind === "CABIN") {
        if (!cabin) cabin = L.cabin;
        if (!bookingClass && L.bookingClass) bookingClass = L.bookingClass;
      } else if (L.kind === "AIRCRAFT") {
        if (!equipRaw) equipRaw = L.text;
      } else if (L.kind === "DURATION") {
        if (duration === undefined) duration = L.minutes;
      } else if (L.kind === "OPBY" && !L.used) {
        opbyIdx = i;
      }
    }

    /* ---- times printed below the flight number (rare layouts) ---- */
    if (!chosenTimerange && pairs.length < 2) {
      for (let i = pos + 1; i < nextAnchor; i++) {
        const L = lines[i];
        if (L.kind === "FLIGHT") break;
        if (L.kind === "TIMERANGE") {
          if (!chosenTimerange) {
            chosenTimerange = L;
            timerangeIdx = i;
          }
          break;
        }
        if (L.kind === "TIME") {
          const nxt = lines[i + 1];
          const code = nxt && nxt.kind === "AIRPORT" && !nxt.layoverAirport ? nxt.airportCode : undefined;
          pairs.push({ min: L.min!, off: L.dayOffset ?? 0, code });
          if (code) i++;
        } else if (L.kind === "ROUTE" && !routeCodes && !headerIdx.has(i)) {
          routeCodes = L.routeCodes;
        }
      }
    }

    /* ---- route + clock ---- */
    let origin: string | undefined;
    let dest: string | undefined;
    let dep: number | undefined;
    let arr: number | undefined;
    let depOff = 0;
    let arrOff = 0;
    if (chosenTimerange) {
      dep = chosenTimerange.dep;
      arr = chosenTimerange.arr;
      depOff = chosenTimerange.depOff ?? 0;
      arrOff = chosenTimerange.arrOff ?? 0;
      if (routeCodes && routeCodes.length >= 2) {
        origin = routeCodes[0];
        dest = routeCodes[routeCodes.length - 1];
      }
    } else if (pairs.length >= 2) {
      const d = pairs[pairs.length - 2];
      const r = pairs[pairs.length - 1];
      dep = d.min;
      arr = r.min;
      depOff = d.off;
      arrOff = r.off;
      origin = d.code;
      dest = r.code;
      if ((!origin || !dest) && routeCodes && routeCodes.length >= 2) {
        origin = origin ?? routeCodes[0];
        dest = dest ?? routeCodes[routeCodes.length - 1];
      }
    } else if (pairs.length === 1) {
      dep = pairs[0].min;
      depOff = pairs[0].off;
      origin = pairs[0].code;
      if (routeCodes && routeCodes.length >= 2) {
        origin = origin ?? routeCodes[0];
        dest = dest ?? routeCodes[routeCodes.length - 1];
      }
    } else {
      if (routeCodes && routeCodes.length >= 2) {
        origin = routeCodes[0];
        dest = routeCodes[routeCodes.length - 1];
      }
    }
    if ((!origin || !dest) && routeCodes && routeCodes.length >= 2) {
      origin = origin ?? routeCodes[0];
      dest = dest ?? routeCodes[routeCodes.length - 1];
    }

    /* ---- date: journey header date shifted by this leg's "+N" marker ---- */
    const date = journeyDate ? addDays(journeyDate, depOff) : undefined;
    let arrDay = arrOff - depOff;
    if (arrDay < 0) arrDay = 0;
    if (arrDay === 0 && dep !== undefined && arr !== undefined && arr < dep) arrDay = 1;
    if (arrDay > 2) arrDay = 2;

    /* ---- operated by: ONLY when explicitly printed for this flight ---- */
    let operatedBy: string | undefined;
    if (opbyIdx >= 0) {
      operatedBy = lines[opbyIdx].operator;
      lines[opbyIdx].used = true;
    }

    /* ---- marketing carrier + equipment, resolved per leg ---- */
    const airline = anchor.airline!;
    const equip = equipRaw ? parseExplicitAircraftString(equipRaw, airline) ?? undefined : undefined;

    flights.push({
      airline,
      number: anchor.number!,
      origin,
      dest,
      date,
      dep,
      arr,
      arrDay: arrDay as 0 | 1 | 2,
      cabin,
      bookingClass,
      equip,
      equipRaw,
      elapsed: duration,
      elapsedExplicit: duration !== undefined,
      operatedBy,
      order: flights.length,
    });

    prevAnchor = pos;
  }

  // Only take over when every printed flight number became a usable leg;
  // otherwise stay silent so the existing parser handles the text.
  const usable = flights.every(
    (f) => !!f.origin && !!f.dest && f.dep !== undefined && f.arr !== undefined && !!f.date
  );
  if (!usable) return null;
  return flights;
}
