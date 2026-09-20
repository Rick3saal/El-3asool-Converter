/**
 * Exact Sabre GDS output construction + final validation.
 *
 * Format rules enforced here:
 *  - main itinerary: NO booking class, EXACTLY two spaces before CABIN-
 *  - <--additional--> carries booking class
 *  - outbound/inbound chained sell entries use NN1 after EVERY segment
 *  - individual sell entries use GK1
 *  - sell entries contain NO spaces; airport code stays intact before status
 *    (CAN + NN1 = CANNN1, never CANN1)
 *  - max 3 segments per chained line
 *  - continuous segment numbering across outbound + inbound
 */
import { Segment, Cabin, Direction, Issue } from "./types";
import { estimateElapsed } from "./airports";
import { airlineFromName } from "./airlines";

const PRIMARY_MARKETING_ALIASES: Record<string, string[]> = {
  AF: ["AF", "AIR FRANCE"],
  AS: ["AS", "ALASKA", "ALASKA AIRLINES"],
  LX: ["LX", "SWISS", "SWISS INTERNATIONAL AIR LINES", "SWISS INTERNATIONAL AIRLINES"],
  UA: ["UA", "UNITED", "UNITED AIRLINES"],
  AA: ["AA", "AMERICAN", "AMERICAN AIRLINES"],
  DL: ["DL", "DELTA", "DELTA AIR LINES", "DELTA AIRLINES"],
  BA: ["BA", "BRITISH AIRWAYS"],
  LH: ["LH", "LUFTHANSA"],
  AC: ["AC", "AIR CANADA"],
  KL: ["KL", "KLM", "KLM ROYAL DUTCH AIRLINES"],
};

const REGIONAL_SUBSIDIARY_KEYWORDS = [
  "EXPRESS", "EAGLE", "CONNECTION", "HOP", "CITYLINE", "CITYFLYER",
  "ROUGE", "JAZZ", "HORIZON", "SKYWEST", "DBA", "AIRLINK", "ENVOY",
  "PIEDMONT", "PSA", "REPUBLIC", "MESA", "COMMUTAIR", "GOJET", "ENDEAVOR",
];

export function shouldPrintOperatedBy(airline: string, operator: string | undefined): boolean {
  if (!operator) return false;
  const opUpper = operator.toUpperCase().trim();
  const alUpper = airline.toUpperCase().trim();

  // Regional or subsidiary operators count as different and still print the line
  const isRegionalOrSubsidiary = REGIONAL_SUBSIDIARY_KEYWORDS.some((kw) =>
    new RegExp(`\\b${kw}\\b`, "i").test(opUpper)
  );
  if (isRegionalOrSubsidiary) return true;

  // Compare against marketing airline code and primary aliases
  const aliases = PRIMARY_MARKETING_ALIASES[alUpper];
  if (aliases) {
    const cleanOp = opUpper.replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
    if (aliases.includes(cleanOp)) return false; // same carrier -> do not print
  }

  // Also check if airlineFromName matches the marketing airline
  const opCode = airlineFromName(opUpper);
  if (opCode && opCode === alUpper) return false;

  return true;
}

const MON3 = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function month3(m: number): string {
  return MON3[(m - 1 + 12) % 12];
}

/** BA 85 -> BA 085; AC 9 stays AC 9; 3+ digits unchanged */
export function displayFlightNumber(raw: string, airline?: string): string {
  // BA prints short flight numbers padded to 3 digits (BA 85 -> 085).
  // Every other carrier keeps the exact number printed in the source
  // (AC 24 stays AC 24, AC 9 stays AC 9, AC 3 stays AC 3).
  if (airline === "BA" && raw.length === 2) return "0" + raw;
  return raw;
}

/** minutes -> Sabre clock e.g. 535 -> 855A, 640 -> 1040A, 830 -> 150P */
export function sabreClock(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 < 12 ? "A" : "P";
  return `${h12}${String(m).padStart(2, "0")}${suffix}`;
}

export function elapsedStr(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}.${String(m).padStart(2, "0")}`;
}

export function dateStr(day: number, month: number, raw?: string): string {
  if (raw && /^\d{2}[A-Z]{3}$/i.test(raw)) return raw.toUpperCase();
  return `${day}${month3(month)}`;
}

export function mainItineraryLine(n: number, s: Segment): string {
  const dayMark = s.arrDay === 0 ? "" : `¥${s.arrDay}`;
  return (
    `${n} ${s.airline} ${s.num} ${dateStr(s.date.day, s.date.month, s.date.raw)} ${s.origin} ${s.dest} ` +
    `${sabreClock(s.dep)} ${sabreClock(s.arr)}${dayMark} ${s.equip} ${elapsedStr(s.elapsed)} 0 N  CABIN-${s.cabin}`
  );
}

export function additionalLine(n: number, s: Segment): string {
  return `${n} ${s.airline} ${s.num}${s.bookingClass} ${dateStr(s.date.day, s.date.month, s.date.raw)}`;
}

export function sellEntry(s: Segment, status: "NN1" | "GK1"): string {
  return (
    `0${s.airline}${s.num}${s.bookingClass}${dateStr(s.date.day, s.date.month, s.date.raw)}` +
    `${s.origin}${s.dest}${status}`
  );
}

/** chain at most 3 per line, every segment carries its own NN1 */
export function chainLines(segments: Segment[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < segments.length; i += 3) {
    const chunk = segments.slice(i, i + 3);
    lines.push(chunk.map((s) => sellEntry(s, "NN1")).join("§"));
  }
  return lines;
}

export function operatedByLine(s: Segment): string | null {
  if (!s.operatedBy) return null;
  if (!shouldPrintOperatedBy(s.airline, s.operatedBy)) return null;
  return `*${s.origin}-${s.dest} OPERATED BY ${s.operatedBy.toUpperCase().trim()}`;
}

/** Validate every produced string against the hard rules. */
export function validateOutput(segments: Segment[], out: Segment[], inn: Segment[], indLines: string[], mainLines: string[], addLines: string[]): Issue[] {
  const issues: Issue[] = [];
  const all = [...out, ...inn];
  const n = segments.length;

  // continuous numbering / counts
  if (all.length !== n) issues.push({ level: "error", text: "Internal: segment count mismatch." });

  // airport codes exactly 3 letters and never truncated before status
  for (const s of all) {
    if (!/^[A-Z]{3}$/.test(s.origin)) issues.push({ level: "error", text: `Internal: origin ${s.origin} invalid.` });
    if (!/^[A-Z]{3}$/.test(s.dest)) issues.push({ level: "error", text: `Internal: dest ${s.dest} invalid.` });
    const nn = sellEntry(s, "NN1");
    const gk = sellEntry(s, "GK1");
    if (!nn.endsWith(s.dest + "NN1")) issues.push({ level: "error", text: `Internal: airport truncated in ${nn}` });
    if (!gk.endsWith(s.dest + "GK1")) issues.push({ level: "error", text: `Internal: airport truncated in ${gk}` });
    if (/\s/.test(nn) || /\s/.test(gk)) issues.push({ level: "error", text: "Internal: space in sell entry." });
  }
  // main itinerary lines only (operated-by notes start with "*")
  for (const l of mainLines) {
    if (!/^\d+ /.test(l)) continue;
    const m = /^\d+ ([A-Z]{2}) (\d{1,4}) /.exec(l);
    if (m && /[A-Z]/.test(l.slice(l.indexOf(m[2]) + m[2].length + 1, l.indexOf(m[2]) + m[2].length + 2))) {
      issues.push({ level: "error", text: "Internal: booking class in main itinerary." });
    }
    if (!/ {2}CABIN-(FIRST|BUSINESS|PREMIUM|ECONOMY)$/.test(l)) {
      issues.push({ level: "error", text: "Internal: malformed cabin field." });
    }
  }
  if (addLines.length !== n) issues.push({ level: "error", text: "Internal: additional count mismatch." });
  for (let i = 0; i < addLines.length; i++) {
    if (!/^\d+ /.test(addLines[i])) issues.push({ level: "error", text: "Internal: additional numbering." });
    const num = parseInt(addLines[i], 10);
    if (num !== i + 1) issues.push({ level: "error", text: "Internal: additional numbering not continuous." });
  }
  // individual: one GK1 per segment, all segments present
  if (indLines.length !== n) issues.push({ level: "error", text: "Internal: individual count mismatch." });
  for (const l of indLines) {
    if (!l.endsWith("GK1")) issues.push({ level: "error", text: "Internal: individual not GK1." });
  }
  // chained lines ≤ 3 entries and each NN1
  for (const dir of [out, inn]) {
    const chains = chainLines(dir);
    for (const c of chains) {
      const parts = c.split("§");
      if (parts.length > 3) issues.push({ level: "error", text: "Internal: chain > 3 segments." });
      for (const p of parts) {
        if (!p.endsWith("NN1")) issues.push({ level: "error", text: "Internal: chained entry missing NN1." });
      }
    }
  }
  // direction grouping
  const outCount = out.length;
  segments.forEach((s, idx) => {
    const expect = idx < outCount ? "OUT" : "IN";
    if (s.direction !== expect) issues.push({ level: "error", text: "Internal: direction mis-grouped." });
  });
  return issues;
}

/** estimate elapsed when the source gave none */
export function resolveElapsed(origin: string, dest: string, dep: number, arr: number, explicit?: number): { minutes: number; confident: boolean } {
  if (explicit !== undefined) return { minutes: explicit, confident: true };
  return estimateElapsed(origin, dest, dep, arr);
}

export type { Segment, Cabin, Direction };
