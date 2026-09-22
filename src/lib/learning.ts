/**
 * Self-learning correction & AI memory.
 *
 * 1. Learned Itineraries (Full Itinerary Level):
 *    When AI extracts flights from an itinerary (or the user teaches one),
 *    the extracted flight structure is saved in persistent memory. Future
 *    conversions of that itinerary (or same itinerary with different dates)
 *    work automatically and instantly — NO AI calls needed.
 *
 * 2. Flight Knowledge Base (Airline + Flight Number Level):
 *    When flights are learned, their core parameters (route, typical times,
 *    aircraft, cabin, booking class, operator) are remembered by carrier and
 *    flight number (e.g. LX 23 is JFK -> GVA, LX 354 is GVA -> LHR). If the
 *    local parser encounters that flight in an unfamiliar layout, it can fill
 *    in any unparsed fields automatically.
 *
 * 3. Flight Corrections (User Edit Level):
 *    When the user edits a converted flight, structural overrides are remembered
 *    per flight identity (airline + flight number + route).
 *
 * 4. Aircraft Phrases:
 *    Phrases like "Airbus A350" -> "350" are remembered once and applied everywhere.
 *
 * Journey-specific fields (date, departure time, arrival time) are adapted
 * to each trip instance.
 */
import type { Cabin, Direction, RawFlight, Segment } from "./types";

export interface FlightCorrection {
  airline: string;
  num: string;
  origin: string;
  dest: string;
  airlineOverride: string;
  numOverride: string;
  equip: string;
  elapsed: number;
  cabin: Cabin;
  bookingClass: string;
  operatedBy?: string;
  direction: Direction;
  arrDay: 0 | 1 | 2;
  updatedAt: number;
}

export interface AircraftCorrection {
  phrase: string; // normalized raw aircraft text
  equip: string;
  updatedAt: number;
}

export interface FlightKnowledge {
  airline: string;
  number: string;
  origin?: string;
  dest?: string;
  dep?: number;
  arr?: number;
  arrDay?: 0 | 1 | 2;
  cabin?: Cabin;
  bookingClass?: string;
  equip?: string;
  equipRaw?: string;
  elapsed?: number;
  operatedBy?: string;
  direction?: Direction;
  updatedAt: number;
}

export interface LearnedItinerary {
  id: string; // unique ID / hash
  normalizedKey: string; // collapsed text for exact/fuzzy matching
  skeletonKey: string; // text without dates for date-adapted matching
  originalSnippet: string; // first ~80 chars for UI display
  summary: string; // e.g. "LX 23 (JFK → GVA), LX 354 (GVA → LHR)"
  flights: RawFlight[];
  updatedAt: number;
}

const LS_FLIGHTS = "el3asool.learned.flights.v1";
const LS_AIRCRAFT = "el3asool.learned.aircraft.v1";
const LS_ENABLED = "el3asool.learned.enabled.v1";
const LS_ITINERARIES = "el3asool.learned.itineraries.v1";
const LS_KNOWLEDGE = "el3asool.learned.knowledge.v1";

/* ---------------- storage backend (localStorage + memory fallback) ---------------- */

let memFlights = new Map<string, FlightCorrection>();
let memAircraft = new Map<string, AircraftCorrection>();
let memItineraries = new Map<string, LearnedItinerary>();
let memKnowledge = new Map<string, FlightKnowledge>();

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* private mode etc. */
  }
  return null;
}

function readJSON<T>(key: string, fallback: T): T {
  const s = storage();
  if (s) {
    try {
      const raw = s.getItem(key);
      if (raw) return JSON.parse(raw) as T;
    } catch {
      /* corrupted -> fall through */
    }
  }
  return fallback;
}

function writeJSON(key: string, value: unknown): void {
  const s = storage();
  if (s) {
    try {
      s.setItem(key, JSON.stringify(value));
    } catch {
      /* quota */
    }
  }
}

function flightMap(): Map<string, FlightCorrection> {
  const s = storage();
  if (s) {
    const arr = readJSON<FlightCorrection[]>(LS_FLIGHTS, []);
    return new Map(arr.map((f) => [flightKey(f.airline, f.num, f.origin, f.dest), f]));
  }
  return memFlights;
}

function saveFlights(map: Map<string, FlightCorrection>): void {
  const s = storage();
  if (s) writeJSON(LS_FLIGHTS, Array.from(map.values()));
  else memFlights = new Map(map);
}

function aircraftMap(): Map<string, AircraftCorrection> {
  const s = storage();
  if (s) {
    const arr = readJSON<AircraftCorrection[]>(LS_AIRCRAFT, []);
    return new Map(arr.map((a) => [a.phrase, a]));
  }
  return memAircraft;
}

function saveAircraft(map: Map<string, AircraftCorrection>): void {
  const s = storage();
  if (s) writeJSON(LS_AIRCRAFT, Array.from(map.values()));
  else memAircraft = new Map(map);
}

function itineraryMap(): Map<string, LearnedItinerary> {
  const s = storage();
  if (s) {
    const arr = readJSON<LearnedItinerary[]>(LS_ITINERARIES, []);
    return new Map(arr.map((it) => [it.id, it]));
  }
  return memItineraries;
}

function saveItineraries(map: Map<string, LearnedItinerary>): void {
  const s = storage();
  if (s) writeJSON(LS_ITINERARIES, Array.from(map.values()));
  else memItineraries = new Map(map);
}

function knowledgeMap(): Map<string, FlightKnowledge> {
  const s = storage();
  if (s) {
    const arr = readJSON<FlightKnowledge[]>(LS_KNOWLEDGE, []);
    return new Map(arr.map((k) => [knowledgeKey(k.airline, k.number), k]));
  }
  return memKnowledge;
}

function saveKnowledge(map: Map<string, FlightKnowledge>): void {
  const s = storage();
  if (s) writeJSON(LS_KNOWLEDGE, Array.from(map.values()));
  else memKnowledge = new Map(map);
}

/* ---------------- keys & normalization ---------------- */

export function flightKey(airline: string, num: string, origin: string, dest: string): string {
  return [airline, num, origin, dest].map((x) => (x || "").toUpperCase().trim()).join("|");
}

export function knowledgeKey(airline: string, num: string): string {
  return `${(airline || "").toUpperCase().trim()}|${(num || "").toUpperCase().replace(/^0+/, "").trim()}`;
}

export function normalizeAircraftPhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Normalized key for exact/fuzzy itinerary matching */
export function normalizeItineraryKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/warning\s*icon/gi, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^\w\s:/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Skeleton key with date words and calendar dates replaced by <DATE> */
export function skeletonItineraryKey(text: string): string {
  return normalizeItineraryKey(text)
    .replace(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*[,.]?\s*/gi, "")
    .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})\b/gi, "<DATE>")
    .replace(/\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\b/gi, "<DATE>")
    .replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, "<DATE>");
}

export function isLearningEnabled(): boolean {
  const s = storage();
  if (s) return s.getItem(LS_ENABLED) !== "0";
  return true;
}

export function setLearningEnabled(on: boolean): void {
  const s = storage();
  if (s) {
    try {
      s.setItem(LS_ENABLED, on ? "1" : "0");
    } catch {
      /* ignore */
    }
  }
}

/* ---------------- public API: User Corrections ---------------- */

export function canSaveItinerary(flights: (RawFlight | Segment)[]): boolean {
  if (!flights || flights.length === 0) return false;
  for (const f of flights) {
    const equip = "equip" in f ? f.equip : undefined;
    if (!equip || equip === "---") return false;
    const hasStar = "hasStarFlag" in f ? f.hasStarFlag : false;
    if (hasStar && !f.operatedBy) return false;
  }
  return true;
}

/** Learn one user-edited flight (full structural snapshot of the edit). */
export function learnFlight(seg: Segment): void {
  // Never save or cache a result that contains "---" or a missing operator for a star flight
  if (!seg.equip || seg.equip === "---") return;
  if (seg.hasStarFlag && !seg.operatedBy) return;

  const corr: FlightCorrection = {
    airline: seg.airline,
    num: seg.num,
    origin: seg.origin,
    dest: seg.dest,
    airlineOverride: seg.airline,
    numOverride: seg.num,
    equip: seg.equip,
    elapsed: Math.round(seg.elapsed),
    cabin: seg.cabin,
    bookingClass: seg.bookingClass,
    operatedBy: seg.operatedBy,
    direction: seg.direction,
    arrDay: seg.arrDay,
    updatedAt: Date.now(),
  };
  const map = flightMap();
  map.set(flightKey(corr.airline, corr.num, corr.origin, corr.dest), corr);
  saveFlights(map);

  // also register in flight knowledge
  learnFlightKnowledge(seg);
}

/** Learn an aircraft phrase -> equipment code mapping (from an equipment edit). */
export function learnAircraft(rawPhrase: string, equip: string): void {
  const phrase = normalizeAircraftPhrase(rawPhrase);
  if (!phrase || !equip) return;
  const map = aircraftMap();
  map.set(phrase, { phrase, equip, updatedAt: Date.now() });
  saveAircraft(map);
}

/* ---------------- public API: Flight Knowledge ---------------- */

/** Save core route/schedule knowledge for a specific airline + flight number. */
export function learnFlightKnowledge(f: RawFlight | Segment): void {
  const al = f.airline;
  const num = "num" in f ? f.num : f.number;
  if (!al || !num) return;
  const map = knowledgeMap();
  const key = knowledgeKey(al, num);
  const prev = map.get(key) || { airline: al, number: num, updatedAt: 0 };
  const updated: FlightKnowledge = {
    ...prev,
    airline: al,
    number: num,
    origin: f.origin ?? prev.origin,
    dest: f.dest ?? prev.dest,
    dep: f.dep ?? prev.dep,
    arr: f.arr ?? prev.arr,
    arrDay: f.arrDay ?? prev.arrDay,
    cabin: f.cabin ?? prev.cabin,
    bookingClass: f.bookingClass ?? prev.bookingClass,
    equip: f.equip ?? prev.equip,
    equipRaw: f.equipRaw ?? prev.equipRaw,
    elapsed: f.elapsed ?? prev.elapsed,
    operatedBy: f.operatedBy ?? prev.operatedBy,
    direction: f.direction ?? prev.direction,
    updatedAt: Date.now(),
  };
  map.set(key, updated);
  saveKnowledge(map);
}

export function lookupFlightKnowledge(airline: string, num: string): FlightKnowledge | undefined {
  if (!isLearningEnabled()) return undefined;
  const map = knowledgeMap();
  return map.get(knowledgeKey(airline, num));
}

/* ---------------- public API: Learned Itineraries ---------------- */

/** Extract dates found in text in reading order */
function extractDatesInText(text: string): Array<{ day: number; month: number }> {
  const MONTHS_MAP: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const dates: Array<{ day: number; month: number }> = [];
  const re = /(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*[,.]?\s+)?([a-z]{3,})[a-z]*\.?[\s,]+(\d{1,2})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const mo = MONTHS_MAP[m[1].slice(0, 3).toLowerCase()];
    const day = parseInt(m[2], 10);
    if (mo && day >= 1 && day <= 31) dates.push({ day, month: mo });
  }
  const re2 = /\b(\d{1,2})[\s,]+([a-z]{3,})[a-z]*\.?\b/gi;
  while ((m = re2.exec(text)) !== null) {
    const mo = MONTHS_MAP[m[2].slice(0, 3).toLowerCase()];
    const day = parseInt(m[1], 10);
    if (mo && day >= 1 && day <= 31) dates.push({ day, month: mo });
  }
  // compact Sabre dates: 18MAY, 24NOV
  const re3 = /\b(\d{1,2})([a-z]{3})\b/gi;
  while ((m = re3.exec(text)) !== null) {
    const mo = MONTHS_MAP[m[2].toLowerCase()];
    const day = parseInt(m[1], 10);
    if (mo && day >= 1 && day <= 31) dates.push({ day, month: mo });
  }
  return dates;
}

/** Build a friendly summary for display in the Self-Learning panel */
function buildItinerarySummary(flights: RawFlight[]): string {
  if (!flights || flights.length === 0) return "Empty itinerary";
  return flights
    .map((f) => `${f.airline} ${f.number}${f.origin && f.dest ? ` (${f.origin} → ${f.dest})` : ""}`)
    .join(", ");
}

/**
 * Save an itinerary and its flights into persistent memory (from AI extraction).
 * Automatically indexes the full itinerary, each individual flight, and
 * any aircraft phrases.
 */
export function learnItinerary(rawText: string, flights: RawFlight[]): LearnedItinerary | null {
  // Never save or cache a result that contains "---", a missing operator, or incomplete lookup
  if (!canSaveItinerary(flights)) return null;

  const normalizedKey = normalizeItineraryKey(rawText);
  const skeletonKey = skeletonItineraryKey(rawText);
  const summary = buildItinerarySummary(flights);
  const id = `itin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const snippet = rawText.trim().replace(/\s+/g, " ").slice(0, 100);

  const entry: LearnedItinerary = {
    id,
    normalizedKey,
    skeletonKey,
    originalSnippet: snippet,
    summary,
    flights: flights.map((f) => ({ ...f })),
    updatedAt: Date.now(),
  };

  const map = itineraryMap();
  // replace any existing entry with the same normalized key
  for (const [key, val] of map) {
    if (val.normalizedKey === normalizedKey) map.delete(key);
  }
  map.set(id, entry);
  saveItineraries(map);

  // automatically learn each flight's knowledge & aircraft
  for (const f of flights) {
    learnFlightKnowledge(f);
    if (f.equipRaw && f.equip && f.equip !== "---") {
      learnAircraft(f.equipRaw, f.equip);
    }
  }

  return entry;
}

export interface MatchResult {
  flights: RawFlight[];
  isAdaptedDates: boolean;
  summary: string;
}

/**
 * Check if the text matches any previously learned itinerary.
 * Returns the flights (with dates adapted if the text has new dates).
 */
export function findLearnedItinerary(rawText: string): MatchResult | null {
  if (!isLearningEnabled()) return null;
  const normKey = normalizeItineraryKey(rawText);
  if (!normKey || normKey.length < 20) return null;

  const map = itineraryMap();
  if (map.size === 0) return null;

  // 1. Exact normalized key match (exact same itinerary re-pasted)
  for (const it of map.values()) {
    if (it.normalizedKey === normKey) {
      return {
        flights: it.flights.map((f) => ({ ...f })),
        isAdaptedDates: false,
        summary: it.summary,
      };
    }
  }

  // 2. Skeleton match: same itinerary text but on different dates
  const skelKey = skeletonItineraryKey(rawText);
  for (const it of map.values()) {
    if (it.skeletonKey === skelKey && it.skeletonKey.length > 30) {
      // adapt dates from the new text
      const newDates = extractDatesInText(rawText);
      const adapted = it.flights.map((f, i) => {
        const next = { ...f };
        if (newDates.length > 0) {
          const matchDate = newDates[i] ?? newDates[0];
          next.date = { day: matchDate.day, month: matchDate.month };
        }
        return next;
      });
      return {
        flights: adapted,
        isAdaptedDates: true,
        summary: it.summary,
      };
    }
  }

  return null;
}

/* ---------------- public API: Listing & Forgetting ---------------- */

export function listLearnedItineraries(): LearnedItinerary[] {
  return Array.from(itineraryMap().values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listLearnedFlights(): FlightCorrection[] {
  return Array.from(flightMap().values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listLearnedAircraft(): AircraftCorrection[] {
  return Array.from(aircraftMap().values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function learnedCount(): number {
  return itineraryMap().size + flightMap().size + aircraftMap().size;
}

export function forgetItinerary(id: string): void {
  const map = itineraryMap();
  map.delete(id);
  saveItineraries(map);
}

export function forgetItineraryForText(rawText: string): boolean {
  const normKey = normalizeItineraryKey(rawText);
  const skelKey = skeletonItineraryKey(rawText);
  const map = itineraryMap();
  let deleted = false;
  for (const [id, it] of Array.from(map.entries())) {
    if (it.normalizedKey === normKey || (skelKey.length > 20 && it.skeletonKey === skelKey)) {
      map.delete(id);
      deleted = true;
    }
  }
  if (deleted) saveItineraries(map);
  return deleted;
}

export function forgetFlight(key: string): void {
  const map = flightMap();
  map.delete(key);
  saveFlights(map);
}

export function forgetAircraft(phrase: string): void {
  const map = aircraftMap();
  map.delete(normalizeAircraftPhrase(phrase));
  saveAircraft(map);
}

export function clearLearned(): void {
  saveFlights(new Map());
  saveAircraft(new Map());
  saveItineraries(new Map());
  saveKnowledge(new Map());
}

/** Apply learned aircraft phrases to a raw equipment text. */
export function lookupLearnedAircraft(equipRaw: string | undefined): string | undefined {
  if (!equipRaw) return undefined;
  const phrase = normalizeAircraftPhrase(equipRaw);
  if (!phrase) return undefined;
  const map = aircraftMap();
  const hit = map.get(phrase);
  if (hit) return hit.equip;
  // try a suffix/prefix match for phrases with extra OCR noise
  for (const [key, val] of map) {
    if (key.length >= 6 && (phrase.includes(key) || key.includes(phrase))) return val.equip;
  }
  return undefined;
}

/**
 * Apply learned flight corrections to parsed segments. Returns a NEW array;
 * never mutates the input. Journey fields (date, times) are untouched.
 */
export function applyLearned(segments: Segment[]): Segment[] {
  const map = flightMap();
  if (map.size === 0) return segments;
  return segments.map((s) => {
    const corr = map.get(flightKey(s.airline, s.num, s.origin, s.dest));
    if (!corr) return s;
    return {
      ...s,
      airline: corr.airlineOverride || s.airline,
      num: corr.numOverride || s.num,
      // User's explicitly edited flight correction takes priority if set; never overwrite with "---"
      equip: (corr.equip && corr.equip !== "---") ? corr.equip : s.equip,
      elapsed: typeof corr.elapsed === "number" ? corr.elapsed : s.elapsed,
      cabin: corr.cabin || s.cabin,
      bookingClass: corr.bookingClass || s.bookingClass,
      operatedBy: corr.operatedBy ?? s.operatedBy,
      direction: corr.direction || s.direction,
      arrDay: corr.arrDay ?? s.arrDay,
    };
  });
}
