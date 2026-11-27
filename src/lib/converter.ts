/**
 * Orchestrator: raw text -> Sabre output.
 * Both TEXT and IMAGE (OCR) flows converge here — one conversion path,
 * one formatter, one validator.
 */
import { Cabin, ConverterResult, Issue, RawFlight, Segment, SourceStated, UnknownClassQuestion } from "./types";
import { parsePreprocessedItinerary, preprocessText, splitDirections } from "./parser";
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
import { lookupCabinForClass, provisionalCabinFor } from "./cabinClasses";
import {
  inferFleetRouteEquipment,
  inferRouteEquipment,
  lookupKnownFlight,
} from "./knownFlights";
import { enforceConnectionDates } from "./dates";
import { dateStr } from "./sabre";

const DEFAULT_CLASS: Record<Cabin, string> = {
  FIRST: "I",
  BUSINESS: "J",
  PREMIUM: "R",
  ECONOMY: "Y",
};

export function convertToSabre(rawText: string, fallbackCabin: Cabin | null): ConverterResult {
  const text = preprocessText(rawText);
  const parse = parsePreprocessedItinerary(text);

  // Learned AI extractions are a fallback, never a replacement for fields the
  // deterministic parser can read from the current source. In particular, an
  // earlier summary-clock mistake must not replace a flight row's arrival.
  if (isLearningEnabled()) {
    const learned = findLearnedItinerary(rawText);
    if (learned && learned.flights.length > 0) {
      const issues: Issue[] = [
        {
          level: "info",
          text: learned.isAdaptedDates
            ? `⚡ Recognized from AI-learned memory (${learned.summary}) with dates from text.`
            : `⚡ Reused AI-learned memory (${learned.summary}) for fields missing from the local parse.`,
        },
      ];
      return convertFlights(mergeSourceFlights(parse.flights, learned.flights), fallbackCabin, [
        ...parse.issues,
        ...issues,
      ]);
    }
  }

  return convertFlights(parse.flights, fallbackCabin, parse.issues);
}

/**
 * Merge AI/cache fields into a deterministic parse. For matching flight IDs,
 * values found locally win; fallback only fills gaps. A local OCR candidate
 * with a different ID but the exact same route/date/times as an AI leg is a
 * duplicate reading of that physical leg, not an extra segment; prefer the AI
 * identity in that case. Keep other local flights and append AI-only flights.
 */
export function mergeSourceFlights(source: RawFlight[], fallback: RawFlight[]): RawFlight[] {
  if (source.length === 0) return fallback.map((flight) => ({ ...flight }));
  const samePhysicalLeg = (a: RawFlight, b: RawFlight) =>
    !!a.origin && !!a.dest && a.origin === b.origin && a.dest === b.dest &&
    !!a.date && !!b.date && a.date.day === b.date.day && a.date.month === b.date.month &&
    a.dep !== undefined && a.dep === b.dep && a.arr !== undefined && a.arr === b.arr;
  const usedFallback = new Set<number>();
  const merged: RawFlight[] = [];
  source.forEach((local, localIndex) => {
    const candidates = fallback
      .map((flight, index) => ({ flight, index }))
      .filter(({ flight, index }) =>
        !usedFallback.has(index) &&
        flight.airline === local.airline &&
        flight.number === local.number &&
        (!local.origin || !local.dest || !flight.origin || !flight.dest ||
          (flight.origin === local.origin && flight.dest === local.dest))
      )
      .sort((a, b) => {
        const routeA = a.flight.origin === local.origin && a.flight.dest === local.dest ? 0 : 1;
        const routeB = b.flight.origin === local.origin && b.flight.dest === local.dest ? 0 : 1;
        return routeA - routeB || Math.abs(a.flight.order - local.order) - Math.abs(b.flight.order - local.order);
      });
    const match = candidates[0];
    if (!match) {
      // A different OCR flight ID on the same fully matching route/schedule is
      // likely noise (e.g. a bogus AD 2 duplicating the printed SV 867 row).
      // Let the AI's identity stand, and omit this duplicate local candidate.
      if (fallback.some((flight, index) => !usedFallback.has(index) && samePhysicalLeg(local, flight))) return;
      merged.push({ ...local, order: localIndex });
      return;
    }
    usedFallback.add(match.index);
    const other = match.flight;
    merged.push({
      ...other,
      ...local,
      airline: local.airline || other.airline,
      number: local.number || other.number,
      origin: local.origin ?? other.origin,
      dest: local.dest ?? other.dest,
      date: local.date ?? other.date,
      dep: local.dep ?? other.dep,
      arr: local.arr ?? other.arr,
      arrDay: local.arrDay,
      cabin: local.cabin ?? other.cabin,
      bookingClass: local.bookingClass ?? other.bookingClass,
      equip: local.equip ?? other.equip,
      equipRaw: local.equipRaw ?? other.equipRaw,
      elapsed: local.elapsed ?? other.elapsed,
      elapsedExplicit: local.elapsedExplicit ?? other.elapsedExplicit,
      operatedBy: local.operatedBy ?? other.operatedBy,
      hasStarFlag: local.hasStarFlag ?? other.hasStarFlag,
      direction: local.direction ?? other.direction,
      directionHint: local.directionHint ?? other.directionHint,
      order: local.order ?? localIndex,
    });
  });

  fallback.forEach((flight, index) => {
    if (usedFallback.has(index)) return;
    const identityAlreadyLocal = source.some((local) =>
      local.airline === flight.airline && local.number === flight.number
    );
    const physicalLegAlreadyLocal = source.some((local) => samePhysicalLeg(local, flight));
    if (!identityAlreadyLocal && !physicalLegAlreadyLocal) merged.push({ ...flight, order: merged.length });
  });
  return merged;
}

/** Use the deterministic source reader to protect data during AI fallback. */
export function mergeAiFallback(rawText: string, aiFlights: RawFlight[]): RawFlight[] {
  const local = parsePreprocessedItinerary(preprocessText(rawText)).flights;
  return mergeSourceFlights(local, aiFlights);
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

  // A connection can never depart before the flight it connects from lands:
  // when a leg follows an overnight one, its date rolls to the next day even
  // though the source printed the journey date only once.
  for (const fix of enforceConnectionDates(ordered)) {
    const f = fix.flight;
    const p = fix.prev;
    issues.push({
      level: "info",
      text:
        `${f.airline} ${displayFlightNumber(f.number, f.airline)} (${f.origin} → ${f.dest}): ` +
        `departure date corrected ${dateStr(fix.from.day, fix.from.month)} → ` +
        `${dateStr(fix.to.day, fix.to.month)} — ` +
        `${p.airline} ${displayFlightNumber(p.number, p.airline)} lands in ${p.dest} on ` +
        `${dateStr(fix.landsOn.day, fix.landsOn.month)}.`,
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

    // Everything the SOURCE stated itself is protected from learned/AI memory.
    const sourceStated: SourceStated = {
      bookingClass: !!(f.bookingClass && /^[A-Z]$/i.test(f.bookingClass)),
      // A stated cabin name, or a stated class letter (whose cabin is derived
      // from that letter) — either way the source decides the cabin.
      cabin: !!f.cabin || !!(f.bookingClass && /^[A-Z]$/i.test(f.bookingClass)),
      operatedBy: !!f.operatedBy,
      elapsed: !!f.elapsedExplicit,
    };

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

    const elapsed = resolveElapsed(f.origin!, f.dest!, f.dep!, f.arr!, f.elapsed, f.date?.month);

    /* Equipment lookup */
    const directEquip = (f.equip && f.equip !== "---")
      ? f.equip
      : (f.equipRaw ? parseExplicitAircraftString(f.equipRaw, f.airline) : null);
    if (directEquip && directEquip !== "---") sourceStated.equip = true;
    let learnedEquip = !directEquip ? lookupLearnedAircraft(f.equipRaw) : undefined;
    let equip = directEquip || learnedEquip;
    if (!equip || equip === "---") {
      const known = lookupKnownFlight(f.airline, f.number, f.origin, f.dest);
      if (known?.equip) equip = known.equip;
    }
    if (!equip || equip === "---") {
      const effectiveOperator = operatedBy || f.operatedBy;
      const fleetPrior = inferFleetRouteEquipment(
        f.airline,
        f.origin,
        f.dest,
        effectiveOperator,
        elapsed.minutes,
        f.date?.month,
        !!f.hasStarFlag
      );
      const inferred = inferRouteEquipment(
        f.airline,
        f.origin,
        f.dest,
        effectiveOperator,
        elapsed.minutes,
        f.date?.month,
        !!f.hasStarFlag
      );
      if (inferred) equip = inferred;
      if (fleetPrior && fleetPrior.equip === inferred) {
        const alternatives = fleetPrior.alternatives.length > 0
          ? ` (alternates: ${fleetPrior.alternatives.join(", ")})`
          : "";
        issues.push({
          level: "info",
          text: `aircraft estimate for ${label}${route}: ${fleetPrior.equip}${alternatives}; route/fleet guidance, not live-verified.`,
        });
      }
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
      sourceStated,
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
  // The leading list number is explanatory only; the Sabre command itself
  // starts after the "N- " prefix.
  const individual = indLines.map((line, i) => `${i + 1}- ${line}`).join("\n");

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
