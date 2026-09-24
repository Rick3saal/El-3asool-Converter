/**
 * Deterministic, local flight-itinerary parser — TEXT PATH ONLY.
 *
 * Reconstructs real flights semantically from messy itinerary text.
 * ONE REAL FLIGHT = ONE SABRE SEGMENT. Aircraft, logos, prices and UI noise
 * can never become segments.
 */
import { RawFlight, ParsedDate, Cabin, Issue } from "./types";
import { airlineFromName, isAirlineCode, AIRLINE_NAMES } from "./airlines";
import { findAircraftTokens, parseExplicitAircraftString } from "./aircraft";
import { cityToCode, sameCity } from "./airports";
import { lookupFlightKnowledge } from "./learning";
import { lookupKnownFlight } from "./knownFlights";
import { lookupCabinForClass } from "./cabinClasses";
import { isGoogleFlightsStyleC, parseGoogleFlightsStyleC } from "./googleflights";

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};
const MON3 = "JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC";

/* ---------------- preprocessing ---------------- */

export function preprocessText(raw: string): string {
  let t = raw.replace(/\r\n?/g, "\n");
  t = t.replace(/https?:\/\/\S+/gi, " ");
  t = t.replace(/www\.\S+/gi, " ");
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/[•·●◦]/g, " · ");
  t = t.replace(/[–—―]/g, "-");
  t = t.replace(/[→➔⇒⟶➜]/g, "→");
  t = t.replace(/[\u00A0\u2009\u202F]/g, " ");
  t = t.replace(/\t+/g, " ");
  t = t.replace(/[ \t]{2,}/g, " ");
  // unglue a "to"/"+N" that ran into a clock time ("to9:20 AM+1" -> "to 9:20 AM+1")
  t = t.replace(/\bto(?=\d{1,2}:\d{2})/gi, "to ");
  t = t.replace(/(\d{1,2}:\d{2})\.([AP]M)\b/gi, "$1 $2");
  return t;
}

function timeToMin(h: number, m: number, pm: boolean): number {
  let hh = h % 12;
  if (pm) hh += 12;
  return hh * 60 + m;
}

/** light OCR confusion cleanup (also safe for typed text) */
export function ocrCleanText(t: string): string {
  let s = t;
  s = s.replace(/(\d)[Oo](?=:|\d)/g, "$10");
  s = s.replace(/(?<=:|\d)[Oo](\d)/g, "0$1");
  s = s.replace(/(\d)[lI|](?=:|\d)/g, "$11");
  s = s.replace(/(?<=:|\d)[lI|](\d)/g, "1$1");
  return s;
}

/* ---------------- tokens ---------------- */

type TokKind =
  | "DATE" | "TIME" | "CITYCODE" | "ROUTE" | "CABIN" | "CLASS" | "ELAPSED"
  | "AIRCRAFT" | "OPBY" | "LAYOVER" | "STOP" | "DAYOFF" | "DIR";

interface Tok {
  kind: TokKind;
  start: number;
  end: number;
  day?: number;
  month?: number;
  raw?: string;
  min?: number;
  bare?: boolean;
  chain?: string[];
  cabin?: Cabin;
  cls?: string;
  elapsed?: number;
  equip?: string;
  operator?: string;
  offset?: 1 | 2;
  /** 1 = token printed inside the flight's own block, 2 = inherited from a
   *  section/trip header paragraph. Own-block data always wins. */
  prio?: 1 | 2;
}

const WEEKDAY = "(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*";
const MON_NAME = `(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*`;

export function cleanOperator(raw: string): string | null {
  // Keep the operator's full trading name ("SKYWEST DBA UNITED EXPRESS").
  // Only strip trailing codeshare flight references and stray punctuation.
  let op = raw
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+as\s+flight\b.*$/i, "")
    .replace(/\s+(?:flight|flt)\s*[A-Z]{0,3}\s*\d{1,4}\s*$/i, "")
    .replace(/[.。,;:]+$/, "")
    .replace(/\)+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!op || op.length < 2 || op.length > 70) return null;
  return op.toUpperCase();
}

function tokenize(text: string): { toks: Tok[]; opbyRanges: Array<[number, number]> } {
  const toks: Tok[] = [];
  const push = (t: Tok) => {
    const dup = toks.some(
      (o) => o.kind === t.kind && Math.abs(o.start - t.start) < 3 && Math.abs(o.end - t.end) < 3
    );
    if (!dup) toks.push(t);
  };
  const opbyRanges: Array<[number, number]> = [];

  const opbyRe = /\boperated\s+by\b[\s:]*/gi;
  let m: RegExpExecArray | null;
  while ((m = opbyRe.exec(text)) !== null) {
    let end = text.indexOf("\n", m.index);
    if (end === -1) end = text.length;
    // inline form: "United 5810 (operated by Skywest Dba United Express)"
    const lineStart = text.lastIndexOf("\n", m.index) + 1;
    const openParen = text.lastIndexOf("(", m.index);
    if (openParen >= lineStart) {
      const close = text.indexOf(")", m.index);
      if (close !== -1 && close < end) end = close;
    }
    const rawOp = text.slice(m.index + m[0].length, end).trim();
    const op = cleanOperator(rawOp);
    if (op) {
      opbyRanges.push([m.index, end + 1]);
      push({ kind: "OPBY", start: m.index, end: end + 1, operator: op });
    }
  }

  // GDS codeshare lines ending with &&: e.g. "AIR CANADA &&", "AIR FRANCE &&", "LUFTHANSA UTSCHE LUFTHANSA AG &&"
  const gdsAmpRe = /(?:^|\n)\s*([A-Za-z\s/.-]+?)\s*&&\s*(?:\n|$)/g;
  while ((m = gdsAmpRe.exec(text)) !== null) {
    const rawOp = m[1].replace(/&&.*$/, "").trim();
    const op = cleanOperator(rawOp);
    if (op) {
      opbyRanges.push([m.index, m.index + m[0].length]);
      push({ kind: "OPBY", start: m.index, end: m.index + m[0].length, operator: op });
    }
  }

  // GDS / Sabre explicit line: "*VTZ-BLR OPERATED BY INDIGO" or "OPERATED BY INDIGO"
  const gdsOpLineRe = /(?:^|\n)\s*(?:\*[A-Z]{3}-[A-Z]{3}\s+)?OPERATED\s+BY\s+([A-Za-z\s/.-]+)(?:\n|$)/gi;
  while ((m = gdsOpLineRe.exec(text)) !== null) {
    const rawOp = m[1].trim();
    const op = cleanOperator(rawOp);
    if (op) {
      opbyRanges.push([m.index, m.index + m[0].length]);
      push({ kind: "OPBY", start: m.index, end: m.index + m[0].length, operator: op });
    }
  }

  /* dates: "Wed, Nov 4", "Nov 4, 2025", "4 Nov" */
  const dateRe = new RegExp(
    `(?<![A-Za-z0-9])(?:${WEEKDAY}[,.]?\\s+)?(${MON_NAME})[a-z]*\\.?[\\s,]+(\\d{1,2})(?:st|nd|rd|th)?(?:[\\s,]+(\\d{4}))?(?![0-9])`,
    "gi"
  );
  while ((m = dateRe.exec(text)) !== null) {
    const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
    const day = parseInt(m[2], 10);
    if (month && day >= 1 && day <= 31)
      push({ kind: "DATE", start: m.index, end: m.index + m[0].length, month, day });
  }
  const dateRe2 = new RegExp(
    `(?<![A-Za-z0-9])(\\d{1,2})(?:st|nd|rd|th)?[\\s,]+(${MON_NAME})[a-z]*\\.?(?:[\\s,]+(\\d{4}))?(?![A-Za-z0-9])`,
    "gi"
  );
  while ((m = dateRe2.exec(text)) !== null) {
    const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
    const day = parseInt(m[1], 10);
    if (month && day >= 1 && day <= 31)
      push({ kind: "DATE", start: m.index, end: m.index + m[0].length, month, day });
  }
  const sabreDateRe = new RegExp(`\\b(\\d{1,2})(${MON3})(?:\\d{2})?\\b`, "g");
  while ((m = sabreDateRe.exec(text)) !== null) {
    const month = MONTHS[m[2].toLowerCase()];
    const day = parseInt(m[1], 10);
    push({
      kind: "DATE",
      start: m.index,
      end: m.index + m[0].length,
      month,
      day,
      raw: (m[1].padStart(2, "0") + m[2]).toUpperCase(),
    });
  }
  const numDateRe = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/g;
  while ((m = numDateRe.exec(text)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    let month: number | null = null;
    let day: number | null = null;
    if (a >= 1 && a <= 12 && b > 12 && b <= 31) { month = a; day = b; }
    else if (b >= 1 && b <= 12 && a > 12 && a <= 31) { month = b; day = a; }
    else continue; // ambiguous numeric date — never guess
    push({ kind: "DATE", start: m.index, end: m.index + m[0].length, month, day });
  }

  /* times */
  const time12Re = /(?<![0-9:])(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)\b/gi;
  while ((m = time12Re.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h <= 12 && mm <= 59)
      push({ kind: "TIME", start: m.index, end: m.index + m[0].length, min: timeToMin(h, mm, /^p/i.test(m[3])) });
  }
  // hour-only times ("7 PM"). Must never fire on the minutes of "11:10 AM",
  // which would invent a bogus 10:00 departure/arrival.
  const hourSuffixRe = /(?<![0-9:.])(\d{1,2})\s*(a\.?m\.?|p\.?m\.?)\b/gi;
  while ((m = hourSuffixRe.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    if (h >= 1 && h <= 12)
      push({ kind: "TIME", start: m.index, end: m.index + m[0].length, min: timeToMin(h, 0, /^p/i.test(m[2])) });
  }
  // bare 24h clock — but NOT when an AM/PM suffix follows (that suffixed token
  // already exists and a twin would corrupt departure/arrival selection)
  const bareTimeRe = /(?<![0-9:])(\d{1,2}):(\d{2})(?![0-9])(?!\s*(?:a\.?m\.?|p\.?m\.?))/gi;
  while ((m = bareTimeRe.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (h <= 23 && mm <= 59)
      push({ kind: "TIME", start: m.index, end: m.index + m[0].length, min: h * 60 + mm, bare: true });
  }
  const sabreTimeRe = /(?<![0-9A-Z])(\d{1,2})([0-5]\d)([AP])(?![0-9A-Za-z])/g;
  while ((m = sabreTimeRe.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    push({ kind: "TIME", start: m.index, end: m.index + m[0].length, min: timeToMin(h, mm, m[3] === "P") });
  }

  // 4-digit 24-hour military times: e.g. "BLR VTZ 0905 1045", "VTZ BLR 1735 1920", "BLR CDG 0145 0800"
  const militaryPairRe =
    /(?<=[A-Z]{3}[\s→\-]+[A-Z]{3}\s+)(0\d|1\d|2[0-3])([0-5]\d)\s*(?:[-–—\s]|to)\s*(0\d|1\d|2[0-3])([0-5]\d)(?:([+¥#])(\d))?/gi;
  while ((m = militaryPairRe.exec(text)) !== null) {
    const depH = parseInt(m[1], 10);
    const depM = parseInt(m[2], 10);
    const arrH = parseInt(m[3], 10);
    const arrM = parseInt(m[4], 10);
    const depStart = m.index;
    const depEnd = depStart + 4;
    push({ kind: "TIME", start: depStart, end: depEnd, min: depH * 60 + depM, bare: true });

    const arrStr = m[3] + m[4];
    const arrStart = m.index + m[0].indexOf(arrStr, 4);
    const arrEnd = arrStart + 4;
    push({ kind: "TIME", start: arrStart, end: arrEnd, min: arrH * 60 + arrM, bare: true });

    if (m[6]) {
      push({ kind: "DAYOFF", start: arrEnd, end: m.index + m[0].length, day: parseInt(m[6], 10) });
    }
  }

  const militarySingleRe =
    /(?<=(?:dep|departure|arr|arrival|depart|arrive)\s*[:：]?\s*)(0\d|1\d|2[0-3])([0-5]\d)(?![0-9])/gi;
  while ((m = militarySingleRe.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    push({ kind: "TIME", start: m.index, end: m.index + m[0].length, min: h * 60 + mm, bare: true });
  }

  /* city codes in parentheses */
  const cityRe = /\(([A-Z]{3})\)/g;
  while ((m = cityRe.exec(text)) !== null) {
    push({ kind: "CITYCODE", start: m.index, end: m.index + m[0].length, chain: [m[1]] });
  }

  /* route chains: JFK -> CAI, Newark (JFK) to Cairo (CAI) */
  for (const rc of extractRouteChains(text)) {
    push({ kind: "ROUTE", start: rc.start, end: rc.end, chain: rc.codes });
  }

  /* day offset markers: "(+1)", "AM+1", "9:20 AM+1", "arrival +1" */
  const dayoffRe = /(?:\barriv\w*[^A-Za-z0-9]{0,45}?|\b\d{1,2}:\d{2}\s*(?:[AP]\.?M\.?)?[^A-Za-z0-9]{0,20}?|[AP]\.?M\.?[^A-Za-z0-9]{0,20}?)\+\s?(\d)\b/gi;
  while ((m = dayoffRe.exec(text)) !== null) {
    const off = parseInt(m[1], 10);
    if (off === 1 || off === 2) push({ kind: "DAYOFF", start: m.index, end: m.index + m[0].length, offset: off as 1 | 2 });
  }
  const nextDayRe = /\b(?:next|following)\s+day\b/gi;
  while ((m = nextDayRe.exec(text)) !== null) {
    push({ kind: "DAYOFF", start: m.index, end: m.index + m[0].length, offset: 1 });
  }
  const plusOneRe = /\(\+(\d)\)\s*(?:day)?/g;
  while ((m = plusOneRe.exec(text)) !== null) {
    const off = parseInt(m[1], 10);
    if (off === 1 || off === 2) push({ kind: "DAYOFF", start: m.index, end: m.index + m[0].length, offset: off as 1 | 2 });
  }

  /* cabin words */
  const cabinRe = /(?<![A-Z0-9-])(premium\s+economy|business|economy|first)(?:\s*class)?(?![A-Za-z])/gi;
  while ((m = cabinRe.exec(text)) !== null) {
    const w = m[1].toLowerCase();
    let cabin: Cabin | null = null;
    if (w === "first") cabin = "FIRST";
    else if (w === "business") cabin = "BUSINESS";
    else if (w === "premium economy") cabin = "PREMIUM";
    else if (w === "economy") cabin = "ECONOMY";
    if (cabin) push({ kind: "CABIN", start: m.index, end: m.index + m[0].length, cabin });
  }

  /* explicit booking classes */
  const classRe1 = /\(([A-Z])\)/g;
  while ((m = classRe1.exec(text)) !== null) {
    push({ kind: "CLASS", start: m.index, end: m.index + m[0].length, cls: m[1] });
  }
  const classRe2 = /\b(?:booking|fare|rbd|reservation)\s*class\s*[:：]?\s*([A-Z])\b/gi;
  while ((m = classRe2.exec(text)) !== null) {
    push({ kind: "CLASS", start: m.index, end: m.index + m[0].length, cls: m[1].toUpperCase() });
  }
  const classRe3 = /\bclass\s*[:：]?\s*([A-Z])\b/gi;
  while ((m = classRe3.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 60), m.index).toLowerCase();
    if (/(booking|fare|rbd|reservation|premium|business|economy|first|seat)/.test(before)) {
      push({ kind: "CLASS", start: m.index, end: m.index + m[0].length, cls: m[1].toUpperCase() });
    }
  }

  // GDS line style: "AF*3775 B 04DEC" or "AF 50 Z 03DEC" or "100 Y 15NOV"
  const gdsClassRe =
    /(?<=(?:[A-Z0-9]{2}[\s\*]+\d{1,4}|\b\d{1,4})\s+)([A-Z])(?=\s+\d{1,2}\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b)/gi;
  while ((m = gdsClassRe.exec(text)) !== null) {
    push({ kind: "CLASS", start: m.index, end: m.index + m[0].length, cls: m[1].toUpperCase() });
  }

  /* elapsed durations */
  const elapsedRe1 =
    /(?<![A-Za-z0-9])(\d{1,2})\s+(?:hours?|hrs?|h)\b(?:\s+(\d{1,2})\s*(?:minutes?|mins?|m)\b)?/gi;
  while ((m = elapsedRe1.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    const mins = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    if (h >= 1 && h <= 30 && mins <= 59)
      push({ kind: "ELAPSED", start: m.index, end: m.index + m[0].length, elapsed: h * 60 + mins });
  }
  const elapsedRe2 = /(?<![A-Za-z0-9])(\d{1,2})h\s*(\d{1,2})?m(?![a-z])/g;
  while ((m = elapsedRe2.exec(text)) !== null) {
    const h = parseInt(m[1], 10);
    const mins = m[2] !== undefined ? parseInt(m[2], 10) : 0;
    if (h >= 1 && h <= 30 && mins <= 59)
      push({ kind: "ELAPSED", start: m.index, end: m.index + m[0].length, elapsed: h * 60 + mins });
  }
  const elapsedRe3 = /(?<![A-Za-z0-9])(\d{1,2})\s+(?:minutes?|mins?)\b/gi;
  while ((m = elapsedRe3.exec(text)) !== null) {
    const mins = parseInt(m[1], 10);
    if (mins >= 30 && mins <= 1200) {
      // skip "50 min" that is the tail of "9 hr 50 min"
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      if (/\d\s*(?:hours?|hrs?|h)\b/i.test(before)) continue;
      push({ kind: "ELAPSED", start: m.index, end: m.index + m[0].length, elapsed: mins });
    }
  }

  /* layover / change planes / stop */
  const layRe = /\b(lay\s*-?\s*over|layover|change\s*-?\s*planes|change\s+of\s+airports?|airport\s+change|connection|transfer)\b/gi;
  while ((m = layRe.exec(text)) !== null) {
    push({ kind: "LAYOVER", start: m.index, end: m.index + m[0].length });
  }
  const stopRe = /\bstops?\b|\bstopover\b/gi;
  while ((m = stopRe.exec(text)) !== null) {
    const before = text.slice(Math.max(0, m.index - 10), m.index);
    if (!/\bnon[\s-]*$/i.test(before)) {
      push({ kind: "STOP", start: m.index, end: m.index + m[0].length });
    }
  }

  /* direction headings */
  const dirNames = ["outbound", "inbound", "return", "departure", "going there", "coming back", "returning"];
  for (const d of dirNames) {
    const dirRe = new RegExp(`^[\\s\\d.·*]*${d.replace(/ /g, "\\s+")}[\\s:]*$`, "gim");
    while ((m = dirRe.exec(text)) !== null) {
      push({ kind: "DIR", start: m.index, end: m.index + m[0].length });
    }
  }

  return { toks, opbyRanges };
}

/** find chains of airport codes joined by arrows / "to" within one line */
function extractRouteChains(
  text: string
): Array<{ codes: string[]; start: number; end: number }> {
  const out: Array<{ codes: string[]; start: number; end: number }> = [];
  const lines = text.split("\n");
  let off = 0;
  for (const line of lines) {
    const lineStart = off;
    const codeToks: Array<{ code: string; start: number; end: number }> = [];
    const plain = /(?<![A-Za-z0-9])([A-Z]{3})(?![A-Za-z0-9])/g;
    let p: RegExpExecArray | null;
    while ((p = plain.exec(line)) !== null) {
      codeToks.push({ code: p[1], start: lineStart + p.index, end: lineStart + p.index + 3 });
    }
    const city = /\(([A-Z]{3})\)/g;
    while ((p = city.exec(line)) !== null) {
      codeToks.push({ code: p[1], start: lineStart + p.index, end: lineStart + p.index + 5 });
    }
    codeToks.sort((a, b) => a.start - b.start);
    const uniq: typeof codeToks = [];
    for (const c of codeToks) {
      const last = uniq[uniq.length - 1];
      if (last && c.start < last.end) continue;
      uniq.push(c);
    }
    off += line.length + 1; // always advance, even when the line has no codes
    if (uniq.length < 2) continue;
    // row style: "UA 929 ORD FRA 130P 400P" — adjacent codes with no arrow
    // belong to the flight on the same line. Only allowed when the line
    // itself contains a real flight (airline code/name + number).
    const lineCoreRe = /\b[A-Z0-9]{2,3}[\s\*]+\d{1,4}\b/;
    const hasCoreOnLine =
      lineCoreRe.test(line) &&
      (() => {
        const mm = /(?<![A-Za-z0-9])([A-Z0-9]{2})\)?(?:\*|\s*\*|\*\s*|[\s-])?(\d{1,4})(?![0-9])/.exec(line);
        if (mm && isAirlineCode(mm[1])) return true;
        return /(?:american\s+airlines|british\s+airways|united\s+airlines|delta\s+air\s+lines|egyptair|air\s+canada|air\s+serbia|qatar\s+airways|emirates|etihad|klm|air\s+france|lufthansa|turkish\s+airlines)\s*\d/i.test(line);
      })();
    let chain: string[] = [];
    let cStart = 0;
    let cEnd = 0;
    const flush = () => {
      if (chain.length >= 2) out.push({ codes: [...chain], start: cStart, end: cEnd });
      chain = [];
    };
    for (let i = 0; i < uniq.length; i++) {
      const cur = uniq[i];
      if (chain.length === 0) {
        chain = [cur.code];
        cStart = cur.start;
        cEnd = cur.end;
        continue;
      }
      const prevEnd = uniq[i - 1].end;
      const between = line.slice(prevEnd - lineStart, cur.start - lineStart);
      const arrow = /→|->|⇒|➔|>/.test(between);
      const wordTo = /\bto\b/i.test(between);
      const hyphen = /^\s*-\s*$/.test(between);
      const plainSpace = hasCoreOnLine && /^[\s(]*$/.test(between) && between.length <= 15;
      if (((arrow || wordTo || hyphen || plainSpace) && !/^\s*[()]*\s*$/.test(between)) || plainSpace) {
        chain.push(cur.code);
        cEnd = cur.end;
      } else {
        flush();
        chain = [cur.code];
        cStart = cur.start;
        cEnd = cur.end;
      }
    }
    flush();
  }
  return out;
}

/* ---------------- flight cores ---------------- */

interface Core {
  airline: string;
  number: string;
  start: number;
  end: number;
  hasStarFlag?: boolean;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "\\s+");
}

function findCores(text: string, opbyRanges: Array<[number, number]>): Core[] {
  const cores: Core[] = [];
  const inOpby = (pos: number) => opbyRanges.some(([a, b]) => pos >= a && pos < b);

  for (const key of AIRLINE_NAMES) {
    const code = airlineFromName(key);
    if (!code) continue;
    const re = new RegExp(
      `(?<![A-Za-z0-9])(?:${escapeRe(key)})\\s*(?:\\([A-Z]{2}\\))?\\s*(?:[-–—]\\s*)?(\\d{1,4})(?![0-9])`,
      "gi"
    );
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (inOpby(m.index)) continue;
      cores.push({
        airline: code,
        number: String(parseInt(m[1], 10)),
        start: m.index,
        end: m.index + m[0].length,
      });
    }
  }

  const codeRe = /(?<![A-Za-z0-9])([A-Z0-9]{2})\)?(?:\*|\s*\*|\*\s*|[\s-])?(\d{1,4})(?![0-9])/g;
  let m: RegExpExecArray | null;
  const aircraftSpans = findAircraftTokens(text).map((a) => [a.start, a.end] as const);
  const inAircraft = (pos: number, end: number) =>
    aircraftSpans.some(([a, b]) => pos < b && end > a);
  while ((m = codeRe.exec(text)) !== null) {
    const code = m[1];
    if (!/[A-Z]/.test(code)) continue;
    if (!isAirlineCode(code)) continue;
    if (inOpby(m.index)) continue;
    if (inAircraft(m.index, m.index + m[0].length)) continue; // never a segment
    const hasStar = m[0].includes("*");
    cores.push({
      airline: code,
      number: String(parseInt(m[2], 10)),
      start: m.index,
      end: m.index + m[0].length,
      hasStarFlag: hasStar,
    });
  }

  return cores.sort((a, b) => a.start - b.start || a.end - b.end);
}

/* ---------------- working flight ---------------- */

interface Work {
  airline: string;
  number: string;
  hasStarFlag?: boolean;
  origin?: string;
  dest?: string;
  date?: ParsedDate;
  dep?: number;
  arr?: number;
  depTokPos?: number;
  arrTokPos?: number;
  arrDay: 0 | 1 | 2;
  arrDayExplicit: boolean;
  /** arrival-day offset derived from a printed arrival date (e.g. "on Tue, Mar 16") */
  arrDayFromDate?: boolean;
  cabin?: Cabin;
  bookingClass?: string;
  equip?: string;
  /** raw aircraft text as printed (for self-learning) */
  equipRaw?: string;
  elapsed?: number;
  elapsedExplicit: boolean;
  operatedBy?: string;
  start: number;
  end: number;
  order: number;
  layover: boolean;
  /** when a direction section heading ("JFK to AMD on ...", "Return",
   *  "Inbound", etc.) precedes this flight, that heading's intent is stored
   *  here so splitDirections can use it as the primary signal. */
  directionHint?: "OUT" | "IN";
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function doy(d: ParsedDate): number {
  let s = 0;
  for (let i = 0; i < d.month - 1; i++) s += MONTH_DAYS[i];
  return s + d.day;
}

function dateGapDays(a: ParsedDate | undefined, b: ParsedDate | undefined): number | null {
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

function tokDist(t: Tok, core: Core): number {
  const c = core.start + (core.end - core.start) / 2;
  const tc = t.start + (t.end - t.start) / 2;
  return Math.abs(c - tc);
}

function hasWordBefore(text: string, pos: number, re: RegExp): boolean {
  return re.test(text.slice(Math.max(0, pos - 80), pos));
}

function pickDepArr(
  text: string,
  times: Tok[],
  _originPos: number | null,
  _destPos: number | null
): { dep: Tok | null; arr: Tok | null } {
  if (times.length === 0) return { dep: null, arr: null };
  // collapse same-position twins (a suffixed token and its bare twin)
  const byStart = new Map<number, Tok>();
  for (const t of times) {
    const prev = byStart.get(t.start);
    // prefer the non-bare token (it carries the explicit AM/PM)
    if (!prev || (prev.bare && !t.bare)) byStart.set(t.start, t);
  }
  const unique = [...byStart.values()].sort((a, b) => a.start - b.start);

  const depWordAt = (t: Tok) => hasWordBefore(text, t.start, /\b(depart\w*|leav\w*|take\s?off)\b/i);
  const arrWordAt = (t: Tok) => hasWordBefore(text, t.start, /\b(arriv\w*|land\w*|reach\w*)\b/i);

  if (unique.length === 1) {
    const t = unique[0];
    const depWord = depWordAt(t);
    const arrWord = arrWordAt(t);
    if (arrWord && !depWord) return { dep: null, arr: t };
    return { dep: t, arr: null };
  }

  // Departure is the first clock printed, arrival the last — unless an
  // explicit "arrives"/"departs" word says otherwise. This is robust across
  // "10:55 AM to 1:02 PM", "10:40 PM JFK → 11:20 AM CAI", and glued forms.
  const firstW = unique.find((t) => depWordAt(t));
  const arrW = [...unique].reverse().find((t) => arrWordAt(t));
  let dep: Tok | null = firstW ?? unique[0];
  let arr: Tok | null = arrW ?? unique[unique.length - 1];
  if (dep && arr && dep.start === arr.start) arr = null;
  return { dep, arr };
}

/* ---------------- Sabre-format fast path ---------------- */

interface FastSeg {
  airline: string;
  numberRaw: number;
  day: number;
  month: number;
  origin: string;
  dest: string;
  dep: number;
  arr: number;
  arrDay: 0 | 1 | 2;
  equip: string;
  elapsed: number;
  cabin: Cabin;
}

function parseSabreTime(digits: string, suffix: string): number {
  const h = parseInt(digits.slice(0, -2), 10) || 0;
  const m = parseInt(digits.slice(-2), 10) || 0;
  const hh = h % 12;
  return (suffix === "P" ? hh + 12 : hh) * 60 + m;
}

function parseSabreBlock(text: string): {
  segs: FastSeg[];
  classes: Map<number, string>;
  opby: Map<number, string>;
} | null {
  const lines = text.split("\n");
  const segs: FastSeg[] = [];
  const classes = new Map<number, string>();
  const opby = new Map<number, string>();
  let anyMain = false;
  let lastSeg = 0;
  const mainRe = new RegExp(
    `^\\s*(?:\\d+\\s+)?([A-Z]{2})\\s+(\\d{1,4})\\s+(\\d{1,2})(${MON3})\\s+([A-Z]{3})\\s+([A-Z]{3})\\s+(\\d{1,4})([AP])\\s+(\\d{1,4})([AP])(?:¥([12]))?\\s+(\\S+)\\s+(\\d{1,2})\\.(\\d{2})\\s+0\\s+N\\s+CABIN-(FIRST|BUSINESS|PREMIUM|ECONOMY)\\s*$`,
    "i"
  );
  const addRe = new RegExp(
    `^\\s*(\\d+)\\s+([A-Z]{2})\\s+(\\d{1,4})([A-Z])\\s+(\\d{1,2})(${MON3})\\s*$`,
    "i"
  );
  const opbyLineRe = /^\s*\*?\s*([A-Z]{3})-([A-Z]{3})\s+OPERATED\s+BY\s+(.+?)\s*$/i;
  for (const line of lines) {
    const mm = mainRe.exec(line);
    if (mm) {
      anyMain = true;
      segs.push({
        airline: mm[1].toUpperCase(),
        numberRaw: parseInt(mm[2], 10),
        day: parseInt(mm[3], 10),
        month: MONTHS[mm[4].toLowerCase()],
        origin: mm[5],
        dest: mm[6],
        dep: parseSabreTime(mm[7], mm[8]),
        arr: parseSabreTime(mm[9], mm[10]),
        arrDay: mm[11] ? (parseInt(mm[11], 10) as 0 | 1 | 2) : 0,
        equip: mm[12].toUpperCase(),
        elapsed: parseInt(mm[13], 10) * 60 + parseInt(mm[14], 10),
        cabin: mm[15].toUpperCase() as Cabin,
      });
      lastSeg = segs.length;
      continue;
    }
    const am = addRe.exec(line);
    if (am) {
      classes.set(parseInt(am[1], 10), am[4].toUpperCase());
      continue;
    }
    const ob = opbyLineRe.exec(line);
    if (ob && lastSeg > 0) {
      const op = cleanOperator(ob[3]);
      if (op) opby.set(lastSeg, op);
    }
  }
  if (!anyMain || segs.length === 0) return null;
  return { segs, classes, opby };
}

/* ---------------- generic parser ---------------- */

function parseGeneric(text: string): { works: Work[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const { toks, opbyRanges } = tokenize(text);
  const cores = findCores(text, opbyRanges);
  if (cores.length === 0) {
    return {
      works: [],
      issues: [{ level: "info", text: "No flights detected in the input." }],
    };
  }

  const aircraftToks = findAircraftTokens(text).filter(
    (a) => !opbyRanges.some(([x, y]) => a.start >= x && a.start < y)
  );
  for (const a of aircraftToks) {
    toks.push({ kind: "AIRCRAFT", start: a.start, end: a.end, equip: a.equip ?? undefined });
  }
  toks.sort((a, b) => a.start - b.start);

  /* ---- ATOMIC FLIGHT-BLOCK OWNERSHIP ----
   * Real itineraries are laid out in blocks: one flight per blank-line
   * separated paragraph. A paragraph's fields (route, date, times, aircraft,
   * cabin, class, duration, operated-by) belong to the flight in THAT
   * paragraph — no matter whether they are printed above or below the flight
   * number line. Paragraphs containing no flight are section/trip headers;
   * they are inherited by the following flight only as a LAST resort
   * (priority 2) and can never override the flight's own data (priority 1).
   * Neighboring flights are never used to complete a flight's fields. */
  const byCore: Tok[][] = cores.map(() => []);

  /* line index (for paragraphs holding more than one flight) */
  const lineStarts: number[] = [0];
  {
    let idx = text.indexOf("\n");
    while (idx !== -1) {
      lineStarts.push(idx + 1);
      idx = text.indexOf("\n", idx + 1);
    }
  }
  const lineOf = (pos: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /* paragraphs (blank-line separated blocks) */
  interface Para {
    start: number;
    end: number;
    coreIdx: number[];
  }
  const paras: Para[] = [];
  {
    const sepRe = /\n[ \t]*\n/g;
    let from = 0;
    let sm: RegExpExecArray | null;
    while ((sm = sepRe.exec(text)) !== null) {
      paras.push({ start: from, end: sm.index, coreIdx: [] });
      from = sm.index + sm[0].length;
    }
    paras.push({ start: from, end: text.length, coreIdx: [] });
  }
  const paraOf = (pos: number): Para => {
    for (const pr of paras) if (pos >= pr.start && pos <= pr.end) return pr;
    return paras[paras.length - 1];
  };
  cores.forEach((c, i) => paraOf(c.start).coreIdx.push(i));

  /* ---- DIRECTION HEADING DETECTION ----
   * A "heading paragraph" is a blank-line-delimited block that:
   *   - contains NO flight core (airline + number), AND
   *   - contains a ROUTE (two airport codes joined by "to"/"→"/"-") AND
   *     a DATE (it announces a journey like "New York (JFK) to Ahmedabad
   *     (AMD) on Tue, Oct 27"), OR contains a DIR word like "Return",
   *     "Outbound", "Inbound".
   * Heading paragraphs never own any flight; they just declare which
   * direction the FOLLOWING flights belong to. The first heading that
   * reverses the origin→dest of the first heading marks the start of the
   * return journey. DIR("Return"/"Inbound") directly marks the return. */
  interface Heading {
    start: number;
    end: number;
    origin?: string;
    dest?: string;
    explicitIn?: boolean; // "Return" / "Inbound" word
    explicitOut?: boolean; // "Outbound" / "Departure" word
  }
  const headings: Heading[] = [];
  for (const pr of paras) {
    if (pr.coreIdx.length > 0) continue; // paragraphs with flights can't be headings
    const prToks = toks.filter(
      (t) => t.start >= pr.start && t.end <= pr.end && t.kind !== "CITYCODE"
    );
    const hasRoute = prToks.some(
      (t) => t.kind === "ROUTE" && t.chain && t.chain.length >= 2
    );
    const hasDate = prToks.some((t) => t.kind === "DATE" && t.month && t.day);
    const hasTime = prToks.some((t) => t.kind === "TIME");
    const hasCabin = prToks.some((t) => t.kind === "CABIN");
    const hasAircraft = prToks.some((t) => t.kind === "AIRCRAFT");
    const hasClass = prToks.some((t) => t.kind === "CLASS");
    const hasLayover = prToks.some((t) => t.kind === "LAYOVER" || t.kind === "STOP");
    const hasElapsed = prToks.some((t) => t.kind === "ELAPSED");
    const hasDir = prToks.some((t) => t.kind === "DIR");
    const dirTok = prToks.find((t) => t.kind === "DIR");
    const dirText = dirTok ? text.slice(dirTok.start, dirTok.end).toLowerCase() : "";
    const isReturnWord = /return|inbound|coming\s+back|returning/.test(dirText);
    const isOutWord = /outbound|departure|going\s+there/.test(dirText);
    // A route+date heading must be a clean summary: no times/cabins/aircraft/etc.
    // (those would make it a flight's own block, not a section heading).
    const isRouteHeading =
      hasRoute &&
      hasDate &&
      !hasTime &&
      !hasCabin &&
      !hasAircraft &&
      !hasClass &&
      !hasLayover &&
      !hasElapsed;
    const isDirHeading = hasDir && !hasRoute && !hasTime && !hasCabin && !hasAircraft;
    if (isRouteHeading || isDirHeading) {
      const routeTok = prToks.find(
        (t) => t.kind === "ROUTE" && t.chain && t.chain.length >= 2
      );
      headings.push({
        start: pr.start,
        end: pr.end,
        origin: routeTok?.chain?.[0],
        dest: routeTok?.chain?.[routeTok.chain.length - 1],
        explicitIn: isReturnWord || (isDirHeading && isReturnWord),
        explicitOut: isOutWord || (isDirHeading && isOutWord),
      });
    }
  }

  // Decide which heading is the return boundary. The first heading is OUT;
  // any later heading that either (a) carries a Return/Inbound word, or
  // (b) reverses the first heading's origin→dest (dest of first heading is
  // this heading's origin, and origin of first heading is this heading's
  // dest — i.e. we're heading back home), marks the IN start.
  let returnStart = -1;
  if (headings.length >= 1) {
    const first = headings[0];
    for (let hi = 1; hi < headings.length; hi++) {
      const h = headings[hi];
      if (h.explicitIn) { returnStart = h.start; break; }
      if (
        first.origin && first.dest &&
        h.origin === first.dest && h.dest === first.origin
      ) {
        returnStart = h.start;
        break;
      }
    }
    // If only one heading exists, it's the outbound heading; no return split
    // is defined by headings — fall back to heuristics later.
  } else {
    // No route/date heading, but there might still be a standalone "Return"
    // DIR paragraph that was absorbed into a flight's paragraph due to
    // missing blank lines. The DIR token is still in toks; treat any DIR
    // position as a potential return boundary.
    for (const dt of toks) {
      if (dt.kind !== "DIR") continue;
      const dtext = text.slice(dt.start, dt.end).toLowerCase();
      if (/return|inbound|coming\s+back|returning/.test(dtext)) {
        returnStart = dt.start;
        break;
      }
    }
  }

  /** owner of a token inside a paragraph that holds several flights */
  const ownerInsideParagraph = (t: Tok, pr: Para): number => {
    const tLine = lineOf(t.start);
    // same line as a flight number → that flight
    for (const ci of pr.coreIdx) {
      if (lineOf(cores[ci].start) === tLine) return ci;
    }
    // otherwise the most recent flight printed above it in this paragraph
    let owner = -1;
    for (const ci of pr.coreIdx) {
      if (cores[ci].start < t.start) owner = ci;
    }
    // nothing above → it heads the paragraph's first flight
    return owner === -1 ? pr.coreIdx[0] : owner;
  };

  for (const t of toks) {
    if (t.kind === "DIR") continue;
    const pr = paraOf(t.start);
    let owner = -1;
    let prio: 1 | 2 = 1;
    if (pr.coreIdx.length === 1) {
      owner = pr.coreIdx[0];
    } else if (pr.coreIdx.length > 1) {
      owner = ownerInsideParagraph(t, pr);
    } else {
      // Header / trailer paragraph. A flight's details may be printed ABOVE or
      // BELOW its own line (route+times above the flight number, aircraft below
      // it, etc.), so we attach the token to the NEAREST flight core by
      // distance. Own-block data always wins (priority 1); this is a fallback.
      prio = 2;
      let bestGap = Infinity;
      for (let i = 0; i < cores.length; i++) {
        const c = cores[i];
        const gap = c.start >= t.end ? c.start - t.end : t.start >= c.end ? t.start - c.end : 0;
        if (gap < bestGap) {
          bestGap = gap;
          owner = i;
        }
      }
      if (owner !== -1 && bestGap > 1600) owner = -1;
    }
    if (owner !== -1) byCore[owner].push({ ...t, prio });
  }

  const works: Work[] = [];

  for (let i = 0; i < cores.length; i++) {
    const core = cores[i];
    const bag = byCore[i];
    const w: Work = {
      airline: core.airline,
      number: core.number,
      hasStarFlag: core.hasStarFlag,
      arrDay: 0,
      arrDayExplicit: false,
      elapsedExplicit: false,
      start: core.start,
      end: core.end,
      order: i,
      layover: false,
    };

    /* Own-block data always wins; header-paragraph data is only a fallback. */
    const own = (kind: TokKind): Tok[] => {
      const all = bag.filter((t) => t.kind === kind);
      const p1 = all.filter((t) => t.prio !== 2);
      return p1.length > 0 ? p1 : all;
    };

    /* ---- origin / destination ----
     * ONLY routes that sit inside THIS flight's own block are candidates.
     * When the block lists several legs under one flight number (technical
     * stop), they chain together; otherwise the leg closest to the core line
     * wins. Trip-summary headers that were attached above the block never
     * override an in-block leg. */
    const routes = own("ROUTE")
      .filter((t) => t.chain && t.chain.length >= 2)
      .map((t) => ({
        codes: t.chain as string[],
        dist: tokDist(t, core),
        start: t.start,
        below: t.start >= core.end,
      }))
      .sort((a, b) => a.dist - b.dist);
    const seen = new Set<string>();
    const uniqueRoutes = routes.filter((r) => {
      const k = r.codes.join("-");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (uniqueRoutes.length > 0) {
      let origin: string | undefined;
      let dest: string | undefined;
      /* A flight's route is printed either above its flight-number line or
       * immediately under it — never after its aircraft/cabin details. A route
       * appearing after those details starts the NEXT journey (e.g. a return
       * header glued to the end of the outbound block) and must not be used. */
      const detailAfterCore = bag
        .filter((t) => (t.kind === "AIRCRAFT" || t.kind === "CABIN") && t.start >= core.end)
        .sort((a, b) => a.start - b.start)[0];
      const cutoff = detailAfterCore ? detailAfterCore.end : Infinity;
      const eligible = uniqueRoutes.filter((r) => r.start < cutoff);
      const pool = eligible.length > 0 ? eligible : uniqueRoutes;
      const chosen = pool[0];
      // technical stop on a lone core: "JFK → CCU" + "CCU → DEL" = one flight.
      // Only legs of THIS flight's own block may combine — never a neighbor's.
      if (cores.length === 1 && pool.length > 1) {
        const cur = pool[0];
        const chainedRoute = pool.find(
          (r) => r !== cur && r.codes[0] === cur.codes[cur.codes.length - 1]
        );
        if (
          chainedRoute &&
          chainedRoute.codes[chainedRoute.codes.length - 1] !== cur.codes[0]
        ) {
          origin = cur.codes[0];
          dest = chainedRoute.codes[chainedRoute.codes.length - 1];
        }
      }
      if (!origin) {
        origin = chosen.codes[0];
        dest = chosen.codes[chosen.codes.length - 1];
      }
      if (origin && dest) {
        w.origin = origin;
        w.dest = dest;
      }
    } else {
      const codeMap = new Map<string, number>();
      for (const t of own("CITYCODE")) {
        if (t.chain && t.chain[0]) {
          const c = t.chain[0];
          if (!codeMap.has(c)) codeMap.set(c, tokDist(t, core));
        }
      }
      const uniqueCodes = Array.from(codeMap.entries());
      if (uniqueCodes.length === 2) {
        w.origin = uniqueCodes[0][0];
        w.dest = uniqueCodes[1][0];
      } else if (uniqueCodes.length > 2) {
        w.origin = uniqueCodes[0][0];
        w.dest = uniqueCodes[uniqueCodes.length - 1][0];
      }
    }

    /* city-name fallback (only unambiguous cities) */
    if (!w.origin || !w.dest) {
      const rawRegion = text.slice(Math.max(0, core.start - 260), Math.min(text.length, core.end + 600));
      const fromTo = /(?:from|fly\w*)\s+([A-Z][A-Za-z .'-]{2,24}?)\s+(?:to|→)\s*([A-Z][A-Za-z .'-]{2,24}?)(?=[\s,.:\n]|$)/i.exec(rawRegion);
      const arrow = /([A-Za-z][A-Za-z .'-]{2,24}?)\s+→\s*([A-Za-z][A-Za-z .'-]{2,24}?)/i.exec(rawRegion);
      const cand = fromTo || arrow;
      if (cand) {
        const o = cityToCode(cand[1]);
        const d = cityToCode(cand[2]);
        if (!w.origin && o) w.origin = o;
        if (!w.dest && d) w.dest = d;
      }
    }

    /* flight knowledge fallback (learned from AI extractions or user corrections):
     * if the layout didn't reveal the route, use the learned route for this carrier + flight number */
    if (!w.origin || !w.dest) {
      const k = lookupFlightKnowledge(w.airline, w.number);
      if (k) {
        if (!w.origin && k.origin) w.origin = k.origin;
        if (!w.dest && k.dest) w.dest = k.dest;
      }
    }

    /* ---- date ----
     * The flight's own departure date. Group headers directly above the core
     * were already bagged with the flight; a shared day header may also sit a
     * few lines above the flight's block (e.g. one date line covering a
     * same-day connection) — allowed only when very close, so a previous
     * flight's or a return section's date can never bleed in. */
    /* Departure date = the date attached to the DEPARTURE time. A time line
     * often prints an arrival-date marker ("10:00 AM to 2:05 PM on Tue,
     * Mar 16") which must NOT be used as the departure date — it feeds the
     * arrival day offset (¥1/¥2) instead. */
    const dateToks = own("DATE").filter((t) => t.month && t.day);
    if (dateToks.length > 0) {
      const timeToks = own("TIME").sort((a, b) => a.start - b.start);
      let depTok: Tok | undefined;
      let arrDateTok: Tok | undefined;
      if (timeToks.length >= 2) {
        const firstT = timeToks[0];
        const lastT = timeToks[timeToks.length - 1];
        // stable assignment: each date belongs to its nearest time token
        const scored = dateToks.map((d) => ({
          d,
          toFirst: Math.abs(d.start - firstT.start),
          toLast: Math.abs(d.start - lastT.start),
        }));
        const toFirst = scored
          .filter((s) => s.toFirst <= s.toLast)
          .sort((a, b) => a.toFirst - b.toFirst);
        const toLast = scored
          .filter((s) => s.toLast < s.toFirst)
          .sort((a, b) => a.toLast - b.toLast);
        depTok = toFirst[0]?.d ?? dateToks[0];
        arrDateTok = toLast[0]?.d;
      } else {
        depTok = dateToks.slice().sort((a, b) => tokDist(a, core) - tokDist(b, core))[0];
      }
      if (depTok) {
        w.date = { day: depTok.day!, month: depTok.month!, raw: depTok.raw };
      }
      if (arrDateTok && w.date) {
        const diff = dateGapDays(w.date, { day: arrDateTok.day!, month: arrDateTok.month! });
        if (diff !== null && diff >= 1 && diff <= 2) {
          w.arrDay = diff as 1 | 2;
          w.arrDayFromDate = true;
        }
      }
    } else {
      const before = toks
        .filter((t) => t.kind === "DATE" && t.end <= core.start && t.month && t.day)
        .sort((a, b) => b.start - a.start);
      if (before.length > 0 && core.start - before[0].end < 420) {
        w.date = { day: before[0].day!, month: before[0].month!, raw: before[0].raw };
      }
    }

    /* ---- origin/dest token positions (for time scoring) ---- */
    let originPos: number | null = null;
    let destPos: number | null = null;
    if (w.origin) {
      const t = bag.find(
        (x) => (x.kind === "ROUTE" && x.chain && x.chain[0] === w.origin) ||
          (x.kind === "CITYCODE" && x.chain && x.chain[0] === w.origin)
      );
      originPos = t ? t.start : null;
    }
    if (w.dest) {
      const t = bag.find(
        (x) => (x.kind === "ROUTE" && x.chain && x.chain[x.chain.length - 1] === w.dest) ||
          (x.kind === "CITYCODE" && x.chain && x.chain[0] === w.dest)
      );
      destPos = t ? t.start : null;
    }

    /* ---- times ---- */
    const times = own("TIME").sort((a, b) => a.start - b.start);
    const { dep, arr } = pickDepArr(text, times, originPos, destPos);
    if (dep) {
      w.dep = dep.min;
      w.depTokPos = dep.start;
    }
    if (arr) {
      w.arr = arr.min;
      w.arrTokPos = arr.start;
    }
    resolveBareTimes(text, times, w);

    /* learned time fallback */
    if (w.dep === undefined || w.arr === undefined) {
      const k = lookupFlightKnowledge(w.airline, w.number);
      if (k) {
        if (w.dep === undefined && k.dep !== undefined) w.dep = k.dep;
        if (w.arr === undefined && k.arr !== undefined) {
          w.arr = k.arr;
          w.arrDay = k.arrDay ?? w.arrDay;
        }
      }
    }

    /* ---- day offset ---- */
    const dayoffs = own("DAYOFF");
    if (dayoffs.length > 0) {
      const arrPos = w.arrTokPos ?? w.depTokPos ?? core.end;
      dayoffs.sort((a, b) => Math.abs(a.start - arrPos) - Math.abs(b.start - arrPos));
      const off = dayoffs[0].offset!;
      w.arrDay = off;
      w.arrDayExplicit = true;
    } else if (!w.arrDayFromDate && w.dep !== undefined && w.arr !== undefined && w.arr < w.dep) {
      w.arrDay = 1;
    }

    /* ---- cabin ----
     * A cabin belongs to its own flight block. The only cross-flight case is
     * a genuine fare header printed ABOVE the whole document (before the very
     * first core) — it may describe every flight in that fare family. Cabin
     * words sitting below another flight's core NEVER leak into this one. */
    const cabins = own("CABIN")
      .filter((t) => t.cabin)
      .sort((a, b) => tokDist(a, core) - tokDist(b, core));
    if (cabins.length > 0) {
      w.cabin = cabins[0].cabin;
    } else if (cores[0].start > 0) {
      const globalHead = toks
        .filter((t) => t.kind === "CABIN" && t.cabin && t.end <= cores[0].start)
        .sort((a, b) => b.start - a.start);
      if (globalHead.length > 0 && core.start - globalHead[0].end < 3000) {
        w.cabin = globalHead[0].cabin;
      }
    }

    /* ---- booking class ---- */
    const clsBag = own("CLASS");
    const nearCabinCls = clsBag.filter(
      (t) => cabins.some((c) => Math.abs(c.start - t.start) < 120) || clsHasKeyword(text, t)
    );
    if (nearCabinCls.length > 0) {
      nearCabinCls.sort((a, b) => tokDist(a, core) - tokDist(b, core));
      w.bookingClass = nearCabinCls[0].cls;
    } else if (clsBag.length > 0) {
      const close = clsBag.filter((t) => tokDist(t, core) < 300);
      if (close.length > 0) w.bookingClass = close[0].cls;
    }

    /* check confirmed or learned cabin for this class */
    if (!w.cabin && w.bookingClass) {
      const confirmedCabin = lookupCabinForClass(w.airline, w.bookingClass);
      if (confirmedCabin) w.cabin = confirmedCabin;
    }

    /* learned cabin / booking class fallback */
    if (!w.cabin || !w.bookingClass) {
      const k = lookupFlightKnowledge(w.airline, w.number);
      if (k) {
        if (!w.cabin && k.cabin) w.cabin = k.cabin;
        if (!w.bookingClass && k.bookingClass) w.bookingClass = k.bookingClass;
      }
    }

    /* ---- aircraft ----
     * Rule: User-supplied aircraft in the flight itinerary data is the primary
     * source of truth. If explicitly supplied, extract and convert it directly.
     * Only use an external / source lookup when the user's input does not provide
     * an aircraft type. Never replace explicitly supplied aircraft with "---".
     */
    const ac = own("AIRCRAFT").sort((a, b) => tokDist(a, core) - tokDist(b, core));
    if (ac.length > 0) {
      const chosen = ac.find((t) => t.equip) ?? ac[0];
      const rawText = text.slice(chosen.start, chosen.end).trim();
      let equipCode = parseExplicitAircraftString(rawText, core.airline) ?? chosen.equip ?? undefined;
      if (core.airline === "AC" && (equipCode === "175" || equipCode === "E75")) {
        equipCode = "E75";
      } else if (core.airline === "AC" && (equipCode === "170" || equipCode === "E70")) {
        equipCode = "E70";
      }
      w.equip = equipCode;
      w.equipRaw = rawText;
    } else {
      // Check if this flight's own paragraph/region contains explicit aircraft text
      const pr = paraOf(core.start);
      const prText = text.slice(pr.start, pr.end);
      const prTokens = findAircraftTokens(prText);
      if (prTokens.length > 0) {
        const bestPr = prTokens.find((t) => t.equip) ?? prTokens[0];
        w.equip = bestPr.equip ?? parseExplicitAircraftString(bestPr.text, core.airline) ?? undefined;
        w.equipRaw = bestPr.text.trim();
      } else {
        // Fallback: only use external/knowledge lookup when the user's input does NOT provide aircraft
        const k = lookupFlightKnowledge(w.airline, w.number);
        if (k?.equip && k.equip !== "---") {
          w.equip = k.equip;
          w.equipRaw = k.equipRaw ?? w.equipRaw;
        }
      }
    }

    /* ---- elapsed ----
     * A layover's duration is always printed on the SAME LINE as its phrase
     * ("Layover in ORD (1h 50m)" / "Change of airport (4h 5m)"). A duration on
     * any other line belongs to the flight itself, so it must be kept — even
     * when it is printed physically close to a layover line. */
    const els = own("ELAPSED").sort((a, b) => tokDist(a, core) - tokDist(b, core));
    if (els.length > 0) {
      const layoverLines = new Set(
        bag
          .filter((t) => t.kind === "LAYOVER" || t.kind === "STOP")
          .map((t) => lineOf(t.start))
      );
      const good = els.filter((e) => !layoverLines.has(lineOf(e.start)));
      if (good.length > 0) {
        w.elapsed = good[0].elapsed;
        w.elapsedExplicit = true;
      }
      // if every duration candidate belongs to a "Layover in X (2h 15m)" line,
      // the flight has no stated duration of its own — never borrow the
      // layover time as flight elapsed time.
    } else {
      const k = lookupFlightKnowledge(w.airline, w.number);
      if (k?.elapsed !== undefined) {
        w.elapsed = k.elapsed;
        w.elapsedExplicit = true;
      }
    }

    /* ---- operated by ---- */
    const ops = own("OPBY")
      .filter((t) => t.operator)
      .sort((a, b) => a.start - b.start);
    if (ops.length > 0) {
      w.operatedBy = (ops.find((o) => o.start >= core.end) ?? ops[ops.length - 1]).operator;
    } else {
      const k = lookupFlightKnowledge(w.airline, w.number);
      if (k?.operatedBy) w.operatedBy = k.operatedBy;
    }

    // Check known-flight table (check it before searching)
    if (!w.operatedBy || !w.equip || w.equip === "---") {
      const known = lookupKnownFlight(w.airline, w.number, w.origin, w.dest);
      if (known) {
        if (!w.operatedBy) w.operatedBy = known.operator;
        if ((!w.equip || w.equip === "---") && known.equip) w.equip = known.equip;
      }
    }

    w.layover = bag.some((t) => t.kind === "LAYOVER");

    works.push(w);
  }

  /* ---- dedupe duplicate listings (union merge) ---- */
  const deduped: Work[] = [];
  for (const w of works) {
    const target = deduped.find(
      (d) =>
        d.airline === w.airline &&
        d.number === w.number &&
        Boolean(d.hasStarFlag) === Boolean(w.hasStarFlag) &&
        (!d.origin || !w.origin || d.origin === w.origin) &&
        (!d.dest || !w.dest || d.dest === w.dest) &&
        (!d.date || !w.date || (d.date.day === w.date.day && d.date.month === w.date.month)) &&
        (d.dep === undefined || w.dep === undefined)
    );
    if (target) mergeWork(target, w);
    else deduped.push({ ...w });
  }

  /* ---- technical-stop merging: same flight number continues ---- */
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < deduped.length - 1; i++) {
      const a = deduped[i];
      const b = deduped[i + 1];
      const backtrack = b.dest === a.origin;
      if (
        a.airline === b.airline &&
        a.number === b.number &&
        !!a.dest && !!b.origin &&
        a.dest === b.origin &&
        !backtrack
      ) {
        const gap = dateGapDays(a.date, b.date);
        const sameOrNext = gap === null || gap <= 1;
        const between = text.slice(a.end, b.start);
        const layoverWord = /\b(lay\s*-?\s*over|layover|change\s*planes|connection|transfer)\b/i.test(between);
        if (sameOrNext && !layoverWord) {
          const first: Work = {
            ...a,
            dest: b.dest,
            arr: b.arr !== undefined ? b.arr : a.arr,
            arrTokPos: b.arrTokPos ?? a.arrTokPos,
            arrDay: b.arrDayExplicit ? b.arrDay : b.arr !== undefined && b.dep !== undefined && b.arr < b.dep ? b.arrDay : a.arrDay,
            elapsedExplicit: a.elapsedExplicit && b.elapsedExplicit,
            elapsed:
              a.elapsedExplicit && b.elapsedExplicit && a.elapsed !== undefined && b.elapsed !== undefined
                ? a.elapsed + b.elapsed
                : a.elapsedExplicit && a.elapsed !== undefined
                  ? a.elapsed
                  : undefined,
            end: b.end,
            operatedBy: a.operatedBy ?? b.operatedBy,
          };
          deduped.splice(i, 2, first);
          merged = true;
          break;
        }
      }
    }
  }

  deduped.forEach((w, idx) => (w.order = idx));

  /* Apply direction hints from detected headings: flights whose flight-number
   * core appears AFTER the return-start heading are tagged IN; flights before
   * that (and all flights if no return heading was found) are tagged OUT.
   * Flights before ANY heading are also OUT (they precede the first header). */
  if (returnStart > -1) {
    for (const w of deduped) {
      w.directionHint = w.start >= returnStart ? "IN" : "OUT";
    }
  } else if (headings.length >= 1) {
    // First heading exists but no return heading: everything after the first
    // heading is OUT (we only saw the outbound summary).
    const firstHeadingEnd = headings[0].end;
    for (const w of deduped) {
      w.directionHint = "OUT";
    }
    // Preserve any stray flights before the first heading? They shouldn't be
    // there in a well-formed paste, but if they exist don't silently retag
    // them — leave them untagged so heuristics decide.
    for (const w of deduped) {
      if (w.start < firstHeadingEnd) delete w.directionHint;
    }
  }

  return { works: deduped, issues };
}

function clsHasKeyword(text: string, t: Tok): boolean {
  const slice = text.slice(Math.max(0, t.start - 90), Math.min(text.length, t.end + 10));
  return /\b(booking|fare|rbd|reservation|class)\b/i.test(slice);
}

function mergeWork(target: Work, w: Work) {
  if (w.hasStarFlag) target.hasStarFlag = true;
  if (!target.origin) target.origin = w.origin;
  if (!target.dest) target.dest = w.dest;
  if (!target.date) target.date = w.date;
  if (target.dep === undefined) {
    target.dep = w.dep;
    target.depTokPos = w.depTokPos;
  }
  if (target.arr === undefined) {
    target.arr = w.arr;
    target.arrTokPos = w.arrTokPos;
  }
  if (!target.cabin) target.cabin = w.cabin;
  if (!target.bookingClass) target.bookingClass = w.bookingClass;
  if (!target.equip) target.equip = w.equip;
  if (!target.equipRaw && w.equipRaw) target.equipRaw = w.equipRaw;
  if (target.elapsed === undefined && w.elapsed !== undefined) {
    target.elapsed = w.elapsed;
    target.elapsedExplicit = w.elapsedExplicit;
  }
  if (!target.operatedBy) target.operatedBy = w.operatedBy;
  if (w.arrDayExplicit && !target.arrDayExplicit) {
    target.arrDay = w.arrDay;
    target.arrDayExplicit = true;
  } else if (w.arrDay > target.arrDay) target.arrDay = w.arrDay;
  target.end = Math.max(target.end, w.end);
  target.layover = target.layover || w.layover;
  // A direction hint is a strong signal; if either duplicate has one, keep it.
  // Prefer IN over OUT if both have hints (an inbound hint on a duplicate
  // means the merge target spans the return boundary).
  if (!target.directionHint && w.directionHint) target.directionHint = w.directionHint;
  else if (target.directionHint === "OUT" && w.directionHint === "IN") target.directionHint = "IN";
}

function resolveBareTimes(text: string, times: Tok[], w: Work) {
  const bare = times.filter((t) => t.bare);
  if (bare.length === 0) return;
  const docHasSuffix = /(?:\d\s*(?:a\.?m\.?|p\.?m\.?))/i.test(text);
  if (!docHasSuffix) return; // treat as 24h or unambiguous
  const depTok = times.find((t) => w.depTokPos !== undefined && t.start === w.depTokPos);
  const arrTok = times.find((t) => w.arrTokPos !== undefined && t.start === w.arrTokPos);
  if (depTok && depTok.bare && w.dep !== undefined && w.arr !== undefined && !(arrTok && arrTok.bare)) {
    const h = Math.floor(w.dep / 60) % 12;
    const m = w.dep % 60;
    const am = h * 60 + m;
    const pm = am + 720;
    const dAm = (w.arr - am + 1440) % 1440;
    const dPm = (w.arr - pm + 1440) % 1440;
    w.dep = dAm <= dPm ? am : pm;
  } else if (arrTok && arrTok.bare && w.arr !== undefined && w.dep !== undefined && !(depTok && depTok.bare)) {
    const h = Math.floor(w.arr / 60) % 12;
    const m = w.arr % 60;
    const am = h * 60 + m;
    const pm = am + 720;
    const dAm = (am - w.dep + 1440) % 1440;
    const dPm = (pm - w.dep + 1440) % 1440;
    w.arr = dAm <= dPm ? am : pm;
  }
}

/* ---------------- direction split ---------------- */

export interface Directional {
  origin?: string;
  dest?: string;
  date?: ParsedDate;
  /** Optional explicit direction hint supplied by the parser when the source
   *  text contains a clear section heading ("X to Y on ...", "Return",
   *  "Outbound", ...). When present, this is the primary split signal;
   *  heuristics are used only as a fallback. */
  directionHint?: "OUT" | "IN";
}

/**
 * Outbound vs inbound is decided by the following priority order:
 *
 *   0. EXPLICIT HEADING HINTS ("X to Y on <date>", "Return", "Outbound",
 *      "Inbound", ...). When flights are tagged with a directionHint, the
 *      first flight whose hint flips from OUT to IN is the return start.
 *      This is the primary signal because the pasted text itself declares
 *      the journey boundary.
 *   1. Largest ground gap (date turnaround) for round trips.
 *   2. Routing backtrack / retrace / route break / same-city return.
 *
 * A new (return) journey begins when:
 *   a. a section heading in the source text announces it (highest priority),
 *   b. flights start retracing already-visited airports / return toward home,
 *   c. the journey resumes into a previously visited destination after a
 *      multi-day gap, OR
 *   d. the pasted text holds two (or more) independent one-way journeys —
 *      the next flight's origin does NOT continue from the previous flight's
 *      destination (a routing break).
 */
export function splitDirections<T extends Directional>(items: T[]): { out: T[]; inn: T[] } {
  if (items.length === 0) return { out: [], inn: [] };

  // 0) Heading-hint driven split. Walk the items and split at the first
  //    transition from OUT→IN in the explicit hints. Hints that re-declare
  //    OUT after an IN are ignored (the first IN stays the boundary).
  const anyHint = items.some((f) => f.directionHint);
  if (anyHint) {
    let split = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].directionHint === "IN") { split = i; break; }
    }
    if (split > 0) {
      const out: T[] = [];
      const inn: T[] = [];
      items.forEach((w, i) => (i < split ? out.push(w) : inn.push(w)));
      return { out, inn };
    }
  }

  const home = items[0].origin;
  const last = items[items.length - 1];
  const isRoundTrip = !!home && !!last.dest && last.dest === home;

  // A round trip returns to its origin. The return journey begins after the
  // longest stay on the ground (the destination holiday/meeting), which shows
  // up as the largest date gap between consecutive flights. This is the only
  // reliable signal when the return uses a different airport in the same city
  // (e.g. Osaka ITM→KIX) so routing continuity alone is not enough.
  if (isRoundTrip && items.length >= 2) {
    let bestIdx = -1;
    let bestGap = -Infinity;
    for (let i = 1; i < items.length; i++) {
      const gap = dateGapDays(items[i - 1].date, items[i].date);
      if (gap !== null && gap > bestGap) {
        bestGap = gap;
        bestIdx = i;
      }
    }
    if (bestIdx > 0 && bestGap >= 2) {
      const out: T[] = [];
      const inn: T[] = [];
      items.forEach((w, i) => (i < bestIdx ? out.push(w) : inn.push(w)));
      return { out, inn };
    }
  }

  const visitedDest = new Set<string>();
  let split = -1;
  for (let i = 0; i < items.length; i++) {
    const f = items[i];
    if (i === 0) {
      if (home) visitedDest.add(home);
      if (f.dest) visitedDest.add(f.dest);
      continue;
    }
    const originVisited = !!home && (f.origin === home || (f.origin ? visitedDest.has(f.origin) : false));
    const destVisited = !!home && (f.dest === home || (f.dest ? visitedDest.has(f.dest) : false));
    const gap = dateGapDays(items[i - 1].date, f.date);
    const backtrack = originVisited && destVisited;
    const retraceHome = !!home && !!f.dest && f.dest === home && originVisited;
    const crossReturn = destVisited && gap !== null && gap >= 1;
    const startsHome = !!home && f.origin === home && i > 0;
    // routing break: a new, independent journey is announced (its origin does
    // not pick up where the previous flight landed). A same-city airport change
    // (Osaka ITM→KIX, Tokyo NRT→HND, …) is NOT a journey break.
    const prev = items[i - 1];
    const routeBreak =
      !!prev.dest && !!f.origin && f.origin !== prev.dest && !sameCity(prev.dest, f.origin);
    if (backtrack || retraceHome || crossReturn || startsHome || routeBreak) {
      split = i;
      break;
    }
    if (f.dest) visitedDest.add(f.dest);
  }
  const out: T[] = [];
  const inn: T[] = [];
  items.forEach((w, i) => (i < split || split === -1 ? out.push(w) : inn.push(w)));
  return { out, inn };
}

/* ---------------- public API ---------------- */

export interface ParseResult {
  flights: RawFlight[];
  issues: Issue[];
  fastPath: boolean;
}

export function parseItineraryText(rawText: string): ParseResult {
  const text = preprocessText(rawText);
  const issues: Issue[] = [];

  /* Sabre-format fast path */
  const sabre = parseSabreBlock(text);
  if (sabre) {
    const raw: RawFlight[] = sabre.segs.map((s, idx) => {
      const cls = sabre.classes.get(idx + 1);
      const opby = sabre.opby.get(idx + 1);
      return {
        airline: s.airline,
        number: String(s.numberRaw),
        origin: s.origin,
        dest: s.dest,
        date: { day: s.day, month: s.month },
        dep: s.dep,
        arr: s.arr,
        arrDay: s.arrDay,
        cabin: s.cabin,
        bookingClass: cls && /^[A-Z]$/.test(cls) ? cls : undefined,
        equip: s.equip,
        elapsed: s.elapsed,
        elapsedExplicit: true,
        operatedBy: opby || undefined,
        order: idx,
      };
    });
    const { out, inn } = splitDirections(raw);
    const flights = [...out, ...inn];
    flights.forEach((f, idx) => {
      f.order = idx;
      f.direction = idx < out.length ? "OUT" : "IN";
    });
    return { flights, issues, fastPath: true };
  }

  /* Google Flights / Style C fast path (ADDITIVE). */
  if (isGoogleFlightsStyleC(text)) {
    const gf = parseGoogleFlightsStyleC(text);
    if (gf && gf.length > 0) {
      const { out, inn } = splitDirections(gf);
      const flights = [...out, ...inn];
      flights.forEach((f, idx) => {
        f.order = idx;
        f.direction = idx < out.length ? "OUT" : "IN";
      });
      return { flights, issues, fastPath: false };
    }
  }

  const { works } = parseGeneric(text);
  if (works.length === 0) {
    return {
      flights: [],
      issues: [{ level: "info", text: "No flights detected. Paste a flight itinerary or a screenshot of one." }],
      fastPath: false,
    };
  }
  const { out, inn } = splitDirections(works);
  const flights: RawFlight[] = [...out, ...inn].map((w) => ({
    airline: w.airline,
    number: w.number,
    origin: w.origin,
    dest: w.dest,
    date: w.date,
    dep: w.dep,
    arr: w.arr,
    arrDay: w.arrDay,
    cabin: w.cabin,
    bookingClass: w.bookingClass,
    hasStarFlag: w.hasStarFlag,
    equip: w.equip,
    equipRaw: w.equipRaw,
    elapsed: w.elapsed,
    elapsedExplicit: w.elapsedExplicit,
    operatedBy: w.operatedBy,
    order: w.order,
    directionHint: w.directionHint,
  }));
  flights.forEach((f, idx) => {
    f.order = idx;
    f.direction = idx < out.length ? "OUT" : "IN";
  });
  if (inn.length === 0 && works.length > 1) {
    issues.push({ level: "info", text: "No return journey detected — all flights treated as outbound." });
  }
  return { flights, issues, fastPath: false };
}
