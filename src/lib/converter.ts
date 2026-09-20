/**
 * Orchestrator: raw text -> Sabre output.
 * Both TEXT and IMAGE (OCR) flows converge here — one conversion path,
 * one formatter, one validator.
 */
import { Cabin, ConverterResult, Issue, RawFlight, Segment, UnknownClassQuestion } from "./types";
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
  lookupLearnedAircraft,
} from "./learning";
import { parseExplicitAircraftString } from "./aircraft";
import {
  lookupCabinForClass,
  provisionalCabinFor,
} from "./cabinClasses";
import {
  inferRouteEquipment,
  lookupKnownFlight,
} from "./knownFlights";

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
  const unknownClassQuestions: UnknownClassQuestion[] = [];
  const failedOperatorFlights: string[] = [];
  const failedEquipmentFlights: string[] = [];
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

    // Cabin & booking class determination:
    // Rule: a line that has a class letter (e.g. Z on AF 191) is NEVER "cabin not stated".
    // Never hide that segment and never offer to replace the letter with a default one.
    let cabin: Cabin;
    let bookingClass: string;

    if (f.bookingClass && /^[A-Z]$/i.test(f.bookingClass)) {
      const letter = f.bookingClass.toUpperCase();
      bookingClass = letter; // keep exactly as given
      if (f.cabin) {
        cabin = f.cabin;
      } else {
        const knownCabin = lookupCabinForClass(f.airline, letter);
        if (knownCabin) {
          cabin = knownCabin;
        } else {
          // Unknown pair: use provisional cabin, and ask "What cabin is <AIRLINE> class <LETTER>?"
          cabin = fallbackCabin || provisionalCabinFor(letter);
          if (!unknownClassQuestions.some((q) => q.airline === f.airline && q.classLetter === letter)) {
            unknownClassQuestions.push({
              airline: f.airline,
              classLetter: letter,
              flightLabel: `${label}${route}`,
            });
          }
        }
      }
    } else if (f.cabin) {
      cabin = f.cabin;
      bookingClass = DEFAULT_CLASS[cabin];
    } else {
      // Neither class letter nor cabin stated: ask for cabin, provisional Economy
      cabin = fallbackCabin ?? "ECONOMY";
      bookingClass = DEFAULT_CLASS[cabin];
      const fltDesc = `${label} · ${f.origin} → ${f.dest}`;
      if (!missingCabinFlights.includes(fltDesc)) {
        missingCabinFlights.push(fltDesc);
      }
    }

    /* Operator lookup */
    let operatedBy = f.operatedBy;
    if (!operatedBy) {
      const known = lookupKnownFlight(f.airline, f.number, f.origin, f.dest);
      if (known?.operator) operatedBy = known.operator;
    }
    if (f.hasStarFlag && !operatedBy) {
      if (!failedOperatorFlights.includes(label)) {
        failedOperatorFlights.push(label);
      }
      issues.push({
        level: "warn",
        text: `operator not found for ${label} (lookup failed).`,
      });
    }

    /* Equipment lookup */
    const directEquip = (f.equip && f.equip !== "---")
      ? f.equip
      : (f.equipRaw ? parseExplicitAircraftString(f.equipRaw, f.airline) : null);
    let learnedEquip = !directEquip ? lookupLearnedAircraft(f.equipRaw) : undefined;
    let equip = directEquip || learnedEquip;
    if (!equip || equip === "---") {
      const known = lookupKnownFlight(f.airline, f.number, f.origin, f.dest);
      if (known?.equip) equip = known.equip;
    }
    if (!equip || equip === "---") {
      const inferred = inferRouteEquipment(f.airline, f.origin, f.dest, operatedBy || f.operatedBy);
      if (inferred) equip = inferred;
    }
    if (!equip || equip === "---") {
      equip = "---";
      if (!failedEquipmentFlights.includes(label)) {
        failedEquipmentFlights.push(label);
      }
      issues.push({
        level: "warn",
        text: `equipment not found for ${label}${route}.`,
      });
    }

    const elapsed = resolveElapsed(f.origin!, f.dest!, f.dep!, f.arr!, f.elapsed, f.date?.month);
    // Note: "duration not stated in the source" warning removed per requirement 6

    segments.push({
      airline: f.airline,
      num: displayFlightNumber(f.number, f.airline),
      date: { day: f.date!.day, month: f.date!.month, raw: f.date!.raw },
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
      hasStarFlag: f.hasStarFlag,
      operatedBy,
      direction: f.direction ?? "OUT",
    });
  }

  /* self-learned corrections: user's edited fields are remembered per flight
   * identity and applied to every future conversion of the same flight. */
  const learnedSegments = applyLearned(segments);

  if (missingCabinFlights.length > 0) {
    issues.push({
      level: "warn",
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

  return assembleFromSegments(
    learnedSegments,
    issues,
    missingCabinFlights,
    unknownClassQuestions,
    failedOperatorFlights,
    failedEquipmentFlights
  );
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
  unknownClassQuestions: UnknownClassQuestion[] = [],
  failedOperatorFlights: string[] = [],
  failedEquipmentFlights: string[] = []
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
    unknownClassQuestions,
    failedOperatorFlights,
    failedEquipmentFlights,
  };
}

export type { Cabin, ConverterResult };
