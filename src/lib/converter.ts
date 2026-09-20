/**
 * Orchestrator: raw text -> Sabre output.
 * Both TEXT and IMAGE (OCR) flows converge here — one conversion path,
 * one formatter, one validator.
 */
import { Cabin, ConverterResult, Issue, RawFlight, Segment, UnresolvedCabinFlight } from "./types";
import { parseItineraryText, splitDirections } from "./parser";
import {
  additionalLine,
  chainLines,
  displayFlightNumber,
  mainItineraryLine,
  operatedByLine,
  resolveElapsed,
  sellEntry,
  validateOutput,
} from "./sabre";
import {
  applyLearned,
  findLearnedItinerary,
  isLearningEnabled,
  lookupFlightKnowledge,
  lookupLearnedAircraft,
} from "./learning";
import { parseExplicitAircraftString } from "./aircraft";
import { cabinFromBookingClass } from "./cabinClasses";
import { lookupKnownFlight } from "./knownFlights";
import { airlineCompareCodeFromName } from "./airlines";
import { elapsedStr } from "./sabre";

const DEFAULT_CLASS: Record<Cabin, string> = {
  FIRST: "I",
  BUSINESS: "J",
  PREMIUM: "R",
  ECONOMY: "Y",
};

export function convertToSabre(rawText: string, fallbackCabin: Cabin | null): ConverterResult {
  // 1. Check if this exact or template itinerary has been learned from AI
  if (isLearningEnabled()) {
    const learned = findLearnedItinerary(rawText);
    if (learned && learned.flights.length > 0) {
      const issues: Issue[] = [
        {
          level: "info",
          text: learned.isAdaptedDates
            ? `⚡ Recognized from AI-learned memory (${learned.summary}) with dates from text.`
            : `⚡ Recognized from AI-learned memory (${learned.summary}) — no AI call needed.`,
        },
      ];
      return convertFlights(learned.flights, fallbackCabin, issues);
    }
  }

  // 2. Local deterministic parser
  const parse = parseItineraryText(rawText);
  return convertFlights(parse.flights, fallbackCabin, parse.issues);
}

/**
 * Convert already-extracted flights to Sabre output. Used by the local parser
 * AND by the AI-assist path — both converge on the exact same formatter and
 * validator so the output is identical regardless of how flights were read.
 */
export function convertFlights(
  flights: RawFlight[],
  fallbackCabin: Cabin | null,
  baseIssues: Issue[] = []
): ConverterResult {
  const issues: Issue[] = [...baseIssues];
  const missingCabinFlights: string[] = [];
  const unresolvedCabins: UnresolvedCabinFlight[] = [];
  const segments: Segment[] = [];
  const excluded: string[] = [];

  // If the caller (e.g. the AI extractor) didn't tag directions, derive them
  // from the routing exactly as the text parser does.
  let ordered = flights;
  if (flights.some((f) => !f.direction)) {
    const { out, inn } = splitDirections(flights);
    ordered = [...out, ...inn];
    ordered.forEach((f, i) => {
      f.order = i;
      f.direction = i < out.length ? "OUT" : "IN";
    });
  }

  for (const f of ordered) {
    const label = `${f.airline} ${displayFlightNumber(f.number, f.airline)}`;
    const route = f.origin && f.dest ? ` (${f.origin} → ${f.dest})` : "";
    const missing: string[] = [];
    if (!f.origin) missing.push("origin");
    if (!f.dest) missing.push("destination");
    if (!f.date || !f.date.day || !f.date.month) missing.push("date");
    if (f.dep === undefined) missing.push("departure time");
    if (f.arr === undefined) missing.push("arrival time");
    if (missing.length > 0) {
      excluded.push(`${label}${route}`);
      issues.push({
        level: "error",
        text: `${label}${route}: missing ${missing.join(", ")} — add this information to the itinerary text so the segment can be built.`,
      });
      continue;
    }
    /* The user's supplied flight data is the primary source of truth for aircraft.
     * Always use explicitly supplied aircraft information first, converting to Sabre code.
     * Only use external / learned lookup when the user's input does not provide aircraft.
     * Never replace explicitly supplied aircraft with "---".
     * Resolved up front because it is needed both for the built segment, for
     * equip-scoped class→cabin rows (AS "I" on 789 vs 737/E75) and for the
     * unresolved-cabin detail the online pass later completes. */
    const knownFlight = lookupKnownFlight(f.airline, f.number, f.origin, f.dest);
    const learnedKnowledge = lookupFlightKnowledge(f.airline, f.number);
    const directEquip = (f.equip && f.equip !== "---")
      ? f.equip
      : (f.equipRaw ? parseExplicitAircraftString(f.equipRaw, f.airline) : null);
    const learnedEquip = !directEquip ? lookupLearnedAircraft(f.equipRaw) : undefined;
    const knownEquip = !directEquip && !learnedEquip ? knownFlight?.equip ?? learnedKnowledge?.equip : undefined;
    const equip = directEquip || learnedEquip || knownEquip || "---";

    /* Cabin resolution. A cabin printed in the source (Style B) is
     * authoritative and skips the letter map entirely. When only a class
     * letter is given (Style A / RBD), the airline-specific map decides —
     * equipped-scoped rows first; the user's learned carrier+knowledge comes
     * next; a manually-picked fallback cabin is the last resort. The booking
     * class LETTER itself is never rewritten. */
    const cabinFromLetter = !f.cabin && f.bookingClass
      ? cabinFromBookingClass(f.airline, f.bookingClass, equip !== "---" ? equip : undefined)
      : null;
    const cabin = f.cabin ?? cabinFromLetter ?? learnedKnowledge?.cabin ?? fallbackCabin;
    if (cabinFromLetter && !f.cabin) {
      issues.push({
        level: "info",
        text: `${label}${route}: cabin ${cabinFromLetter} inferred from booking class ${f.bookingClass} (${f.airline}).`,
      });
    }

    /* Elapsed/block time: DST-aware UTC math (real airport timezone + the
     * flight date) always wins; a stated duration is only trusted when
     * timezone math is impossible. */
    const elapsed = resolveElapsed(f.origin!, f.dest!, f.dep!, f.arr!, f.date, f.elapsed);
    if (elapsed.overrode && f.elapsedExplicit) {
      issues.push({
        level: "warn",
        text: `${label}${route}: duration in the source reads ${elapsedStr(f.elapsed!)} but timezones+date give ${elapsedStr(elapsed.minutes)} — using the calculated value.`,
      });
    }

    /* Operated-by: the source's named operator wins; otherwise the built-in
     * known-flight table (e.g. AS 2010 SEA-YVR → Horizon Air — this also
     * resolves Style A's "AS*2010" flag) or learned knowledge supplies it.
     * Resolved before the cabin gate so the unresolved-cabin record and the
     * segment share it. */
    const resolvedOperatedBy = f.operatedBy ?? knownFlight?.operatedBy ?? learnedKnowledge?.operatedBy;

    if (!cabin) {
      // A bare booking-class letter with no known airline map and no fallback:
      // keep the full detail so the online pass can resolve the letter and
      // build the segment (in its original position) without re-parsing.
      if (f.bookingClass && /^[A-Z]$/.test(f.bookingClass)) {
        unresolvedCabins.push({
          airline: f.airline,
          number: f.number,
          num: displayFlightNumber(f.number, f.airline),
          origin: f.origin!,
          dest: f.dest!,
          date: { day: f.date!.day, month: f.date!.month },
          dep: f.dep!,
          arr: f.arr!,
          arrDay: f.arrDay,
          equip,
          equipRaw: f.equipRaw,
          elapsed: elapsed.minutes,
          operatedBy: resolvedOperatedBy,
          direction: f.direction ?? "OUT",
          bookingClass: f.bookingClass,
          insertAt: segments.length,
        });
      }
      missingCabinFlights.push(`${label} · ${f.origin} → ${f.dest}`);
      continue;
    }
    const classFromSource = !!f.bookingClass && /^[A-Z]$/.test(f.bookingClass);
    // The letter prints exactly as the source gave it; only a source cabin
    // with NO letter falls back to the per-cabin default (learned letters win).
    const bookingClass = classFromSource ? f.bookingClass! : (learnedKnowledge?.bookingClass ?? DEFAULT_CLASS[cabin]);
    if (!directEquip && !learnedEquip && !knownEquip) {
      issues.push({
        level: "warn",
        text: `${label}${route}: aircraft not found in the source — equipment shown as ---. Add the aircraft type to the itinerary if you want it filled automatically.`,
      });
    }
    if (!elapsed.confident && !f.elapsedExplicit) {
      issues.push({
        level: "warn",
        text: `${label}${route}: duration not stated in the source — elapsed time estimated from clock times.`,
      });
    }
    /* The operated-by line prints ONLY when the operator (compared by IATA
     * code via the name map, aliases included) differs from the marketing
     * carrier. "Operated by Swiss" on LX 23 prints nothing; "Horizon Air" on
     * AS metal prints. Unknown operator names always print so no information
     * is lost. */
    let operatedBy: string | undefined;
    if (resolvedOperatedBy) {
      const opCode = airlineCompareCodeFromName(resolvedOperatedBy);
      if (opCode !== f.airline) operatedBy = resolvedOperatedBy;
    }
    segments.push({
      airline: f.airline,
      num: displayFlightNumber(f.number, f.airline),
      date: { day: f.date!.day, month: f.date!.month },
      origin: f.origin!,
      dest: f.dest!,
      dep: f.dep!,
      arr: f.arr!,
      arrDay: f.arrDay,
      equip,
      equipRaw: f.equipRaw,
      elapsed: elapsed.minutes,
      cabin,
      bookingClass,
      operatedBy,
      direction: f.direction ?? "OUT",
      classFromSource,
    });
  }

  /* self-learned corrections: user's edited fields are remembered per flight
   * identity and applied to every future conversion of the same flight. */
  const learnedSegments = applyLearned(segments);

  if (missingCabinFlights.length > 0) {
    issues.push({
      level: "error",
      text:
        missingCabinFlights.length === 1
          ? `${missingCabinFlights[0]}: cabin not stated in the source — choose a cabin below so the booking class can be assigned.`
          : `${missingCabinFlights.length} flights have no stated cabin — choose a cabin below to assign their booking classes.`,
    });
  }
  if (excluded.length > 0) {
    issues.push({
      level: "error",
      text: `${excluded.length} flight(s) skipped: ${excluded.join(" · ")}`,
    });
  }

  return assembleFromSegments(learnedSegments, issues, missingCabinFlights, unresolvedCabins);
}

/**
 * Build every Sabre output section from a list of resolved segments.
 * Used both by the text/OCR conversion path and by the live "edit results"
 * path, so edited output always goes through the same formatter + validator.
 */
export function assembleFromSegments(
  segments: Segment[],
  issues: Issue[] = [],
  missingCabinFlights: string[] = [],
  unresolvedCabins: UnresolvedCabinFlight[] = []
): ConverterResult {
  const outSegs = segments.filter((s) => s.direction === "OUT");
  const inSegs = segments.filter((s) => s.direction === "IN");
  const segsInOrder = segments; // numbered continuously as parsed (out then in)

  // continuous numbering
  const numOf = new Map<Segment, number>();
  segsInOrder.forEach((s, i) => numOf.set(s, i + 1));

  const mainLines: string[] = [];
  const addLines: string[] = [];
  for (const s of segsInOrder) {
    const n = numOf.get(s)!;
    mainLines.push(mainItineraryLine(n, s));
    const ob = operatedByLine(s);
    if (ob) mainLines.push(ob);
    addLines.push(additionalLine(n, s));
  }

  const outLines = chainLines(outSegs);
  const inLines = chainLines(inSegs);
  const indLines = segsInOrder.map((s) => sellEntry(s, "GK1"));

  const itinerary =
    mainLines.length > 0
      ? mainLines.join("\n") + "\n\n<--additional-->\n" + addLines.join("\n")
      : "";
  const outbound = outLines.join("\n");
  const inbound = inLines.join("\n");
  const individual = indLines.join("\n");

  const internal = validateOutput(segments, outSegs, inSegs, indLines, mainLines, addLines);
  for (const v of internal) issues.push(v);

  return {
    itinerary,
    outbound,
    inbound,
    individual,
    segments,
    issues,
    hasOutput: segments.length > 0,
    missingCabinFlights,
    unresolvedCabins,
  };
}

export type { Cabin, ConverterResult };
