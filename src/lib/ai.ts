/**
 * AI-assisted itinerary extraction.
 *
 * The local deterministic parser stays the primary path (fast, offline, exact).
 * For itineraries in unfamiliar layouts the user can enable AI Assist: the raw
 * text (or OCR text from a screenshot) is sent to a vision/LLM provider with a
 * strict extraction prompt, and the structured result is fed through the SAME
 * Sabre converter — so the output format never changes.
 *
 * The user supplies their own API key, stored only in this browser.
 */
import type { Cabin, RawFlight } from "./types";
import { timeToMinutes } from "./aiTime";
import { findAircraftTokens, parseExplicitAircraftString } from "./aircraft";

export type AiProvider = "gemini" | "openai" | "custom";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string; // for "custom" (OpenAI-compatible)
  /** Fill missing aircraft & resolve unknown booking-class letters online (Gemini + Google Search). */
  searchOnline: boolean;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "gemini",
  apiKey: "",
  model: "gemini-3.6-flash",
  baseUrl: "",
  searchOnline: true,
};

export function defaultModelFor(provider: AiProvider): string {
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "custom") return "gpt-4o-mini";
  return "gemini-3.6-flash";
}

/** Suggested models for the picker (all 1M-token context on Gemini).
 *  gemini-2.5-flash / gemini-2.5-pro are intentionally omitted: they 404 for
 *  new API keys. */
export const GEMINI_MODEL_SUGGESTIONS = [
  "gemini-3.6-flash",
  "gemini-3.7-flash",
  "gemini-3.8-flash",
  "gemini-3.5-flash",
];

/** Gemini models that support the Google Search grounding tool. */
const GROUNDING_MODELS = new Set([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3-flash",
  "gemini-2.0-flash",
]);

const SYSTEM_PROMPT = `You are a flight-itinerary extraction engine for a Sabre GDS converter.
Read the ENTIRE text and return ONLY the real flights as JSON.

Rules:
- ONE real flight = one object. NEVER create an object for an aircraft type,
  airline logo, price, duration, layover text, or generic website UI.
- "Aircraft" describes the flight's equipment — it is NOT a separate flight.
- Use the MARKETING carrier's IATA code (e.g. American Airlines=AA, Air Serbia=JU,
  British Airways=BA, Egyptair=MS, Swiss=LX, Jetstar Japan=GK, JAL=JL).
- Airports are exactly 3-letter IATA codes. Keep them EXACT (JFK≠EWR, HND≠NRT).
  If a segment is labelled "Change of airport", the next segment departs from the
  NEW airport (e.g. Osaka ITM→KIX means the following flight leaves KIX).
- For "Layover in X" / "Change planes in X" the connection is a separate flight
  (separate object). A technical stop where the SAME flight number continues is
  ONE object using the true origin and final destination.
- Times are 24-hour "HH:MM" LOCAL. If only 12-hour is shown, convert it.
- arrivalDayOffset: 0 same day, 1 next day (+1), 2 two days later.
- cabin: ONLY set FIRST / BUSINESS / PREMIUM / ECONOMY when the source
  explicitly prints a cabin NAME (e.g. "Business", "First Class", "Premium
  Economy", "Economy", or "Business (P)"). If the source shows only a bare
  booking-class LETTER without a cabin name (e.g. "W", "EY 22 W 14DEC"),
  return cabin null and put that single letter in bookingClass — NEVER guess a
  cabin from the letter (the converter resolves it against the airline's own
  fare chart).
- bookingClass is the single letter if the source states one (e.g. "Business
  (P)" -> "P"), else "".
- operatedBy: the operator name exactly as printed if the source says
  "Operated by X" (keep the whole name, e.g. "SKYWEST DBA UNITED EXPRESS"), else "".
- Preserve source order; it is usually outbound flights first, then the return.
- Do NOT invent data. If a field is truly absent, use "" (or null).

- durationMinutes: the flight's OWN block/elapsed time in MINUTES, exactly as
  printed for that flight (e.g. "(1h 27m)" -> 87, "(13h 20m)" -> 800,
  "3h 0m" -> 180). NEVER use a layover/connection duration ("Layover in PHL
  (2h 0m)") — that belongs to the connection, not to any flight. If the flight
  itself shows no duration, use null.
- aircraft: copy the aircraft text EXACTLY as printed (e.g. "Embraer ERJ-145",
  "Airbus A321neo", "Boeing 737 MAX 9 Passenger"). Never leave it blank when
  the source shows one.

Return JSON of this exact shape:
{"flights":[{
  "airline":"LX","flightNumber":"23","origin":"JFK","destination":"GVA",
  "date":{"day":9,"month":11},"departure":"19:35","arrival":"09:20",
  "arrivalDayOffset":1,"aircraft":"Airbus A330-300","durationMinutes":465,
  "cabin":"BUSINESS","bookingClass":"P","operatedBy":"SWISS"
}]}
Output JSON only, no prose.`;

export interface AiFlightJson {
  airline?: string;
  flightNumber?: string | number;
  origin?: string;
  destination?: string;
  date?: { day?: number; month?: number } | string;
  departure?: string;
  arrival?: string;
  arrivalDayOffset?: number;
  aircraft?: string;
  cabin?: string;
  bookingClass?: string;
  operatedBy?: string;
  /** the flight's own block time in minutes (never a layover duration) */
  durationMinutes?: number | string | null;
  /** tolerated aliases some models emit instead of durationMinutes */
  duration?: number | string | null;
  elapsedMinutes?: number | string | null;
}

/** Accept 465, "465", "7h 45m", "7:45", "7h", "45m" -> minutes */
function parseDurationField(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v);
  const s = String(v).trim();
  if (!s) return undefined;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return n > 0 ? n : undefined;
  }
  const hm = /^(\d{1,2})\s*[h:]\s*(\d{1,2})?\s*m?$/i.exec(s);
  if (hm) {
    const h = parseInt(hm[1], 10);
    const mm = hm[2] ? parseInt(hm[2], 10) : 0;
    const total = h * 60 + mm;
    return total > 0 ? total : undefined;
  }
  const hOnly = /^(\d{1,2})\s*h(?:ours?|rs?)?$/i.exec(s);
  if (hOnly) return parseInt(hOnly[1], 10) * 60;
  const mOnly = /^(\d{1,4})\s*m(?:in(?:ute)?s?)?$/i.exec(s);
  if (mOnly) {
    const n = parseInt(mOnly[1], 10);
    return n > 0 ? n : undefined;
  }
  const loose = /(\d{1,2})\s*h[^0-9]*(\d{1,2})?/i.exec(s);
  if (loose) {
    const h = parseInt(loose[1], 10);
    const mm = loose[2] ? parseInt(loose[2], 10) : 0;
    const total = h * 60 + mm;
    return total > 0 ? total : undefined;
  }
  return undefined;
}

const MONTHS_ABBR: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDateField(d: AiFlightJson["date"]): { day: number; month: number } | null {
  if (!d) return null;
  if (typeof d === "object") {
    const day = Number(d.day);
    const month = Number(d.month);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { day, month };
    return null;
  }
  // strings like "9NOV", "Nov 9", "11/09", "2025-11-09"
  const s = String(d).trim();
  let m = /^(\d{1,2})\s*([A-Za-z]{3,})/.exec(s);
  if (m) {
    const mo = MONTHS_ABBR[m[2].slice(0, 3).toLowerCase()];
    if (mo) return { day: parseInt(m[1], 10), month: mo };
  }
  m = /^([A-Za-z]{3,})\.?\s*(\d{1,2})/.exec(s);
  if (m) {
    const mo = MONTHS_ABBR[m[1].slice(0, 3).toLowerCase()];
    if (mo) return { day: parseInt(m[2], 10), month: mo };
  }
  m = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return { day: parseInt(m[3], 10), month: parseInt(m[2], 10) };
  return null;
}

const CABIN_SET = new Set<Cabin>(["FIRST", "BUSINESS", "PREMIUM", "ECONOMY"]);

function normCabin(c: string | undefined): Cabin | undefined {
  if (!c) return undefined;
  const v = c.toUpperCase().trim();
  if (CABIN_SET.has(v as Cabin)) return v as Cabin;
  if (v.startsWith("PREMIUM")) return "PREMIUM";
  if (v.startsWith("BUS")) return "BUSINESS";
  if (v.startsWith("FIRST")) return "FIRST";
  if (v.startsWith("ECON")) return "ECONOMY";
  return undefined;
}

/** Convert the model's JSON into our internal RawFlight objects. */
export function toRawFlights(json: { flights?: AiFlightJson[] }): RawFlight[] {
  const out: RawFlight[] = [];
  const arr = Array.isArray(json.flights) ? json.flights : [];
  arr.forEach((j, i) => {
    const airline = (j.airline || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    const number = String(j.flightNumber ?? "").replace(/[^0-9]/g, "");
    const origin = (j.origin || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    const dest = (j.destination || "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3);
    if (!airline || !number || !origin || !dest) return;
    const date = parseDateField(j.date);
    const dep = timeToMinutes(j.departure);
    const arr2 = timeToMinutes(j.arrival);
    const off = Number(j.arrivalDayOffset);
    // Map the AI-supplied aircraft phrase through the SAME equipment mapper the
    // local parser uses. The explicit string parser is authoritative; the token
    // scanner is only a fallback for phrases embedded in longer text.
    const acPhrase = j.aircraft ? String(j.aircraft).trim() : "";
    const acExplicit = acPhrase ? parseExplicitAircraftString(acPhrase, airline) : null;
    const acTok = !acExplicit && acPhrase
      ? findAircraftTokens(acPhrase).find((t) => t.equip)
      : undefined;
    const equip = acExplicit ?? acTok?.equip ?? undefined;

    // The flight's own duration, if the model reported one.
    const elapsed =
      parseDurationField(j.durationMinutes) ??
      parseDurationField(j.duration) ??
      parseDurationField(j.elapsedMinutes);

    out.push({
      airline,
      number,
      origin,
      dest,
      date: date ?? undefined,
      dep: dep ?? undefined,
      arr: arr2 ?? undefined,
      arrDay: off === 1 || off === 2 ? (off as 1 | 2) : 0,
      cabin: normCabin(j.cabin),
      bookingClass: j.bookingClass && /^[A-Z]$/i.test(j.bookingClass) ? j.bookingClass.toUpperCase() : undefined,
      equip,
      equipRaw: acPhrase || undefined,
      elapsed,
      elapsedExplicit: elapsed !== undefined,
      operatedBy: j.operatedBy ? j.operatedBy.toUpperCase() : undefined,
      order: i,
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Provider calls                                                      */
/* ------------------------------------------------------------------ */

async function callGemini(text: string, s: AiSettings): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    s.model || "gemini-2.0-flash"
  )}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  if (!res.ok) throw new Error(geminiError(res.status, await safeText(res)));
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const out = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || "").join("") : "";
  if (!out) throw new Error("Gemini returned no content.");
  return out;
}

async function callOpenAI(text: string, s: AiSettings): Promise<string> {
  const base = (s.provider === "custom" && s.baseUrl ? s.baseUrl : "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${s.apiKey}`,
    },
    body: JSON.stringify({
      model: s.model || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new Error("OpenAI returned no content.");
  return out;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Friendlier, actionable Gemini HTTP errors (404 model, quota/billing, key). */
function geminiError(status: number, body: string): string {
  if (status === 404) {
    return "Gemini model not found (404) — that model isn't available for your API key. Pick a current model like gemini-3.x-flash in AI Assist.";
  }
  if (status === 429) {
    return "Gemini quota or billing limit reached (429) — check your Google AI Studio billing, or try again in a moment.";
  }
  if (status === 403) {
    return "Gemini rejected the request (403) — check that your API key is valid and has access to this model.";
  }
  if (status === 400) {
    return `Gemini rejected the request (400): ${body}`;
  }
  return `Gemini ${status}: ${body}`;
}

function extractJson(raw: string): unknown {
  let s = raw.trim();
  // strip code fences
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {
    // grab the first {...} block
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(s.slice(start, end + 1));
    }
    throw new Error("AI response was not valid JSON.");
  }
}

/** Send text to the configured AI provider and return structured flights. */
export async function extractFlightsWithAI(text: string, settings: AiSettings): Promise<RawFlight[]> {
  if (!settings.apiKey) throw new Error("No API key configured.");
  const content =
    settings.provider === "gemini" ? await callGemini(text, settings) : await callOpenAI(text, settings);
  const json = extractJson(content) as { flights?: AiFlightJson[] };
  const flights = toRawFlights(json);
  if (flights.length === 0) throw new Error("The AI did not find any flights in that text.");
  return flights;
}

/* ------------------------------------------------------------------ */
/* Online enrichment lookup (aircraft + booking-class → cabin)         */
/* ------------------------------------------------------------------ */

export interface OnlineLookupItem {
  airline: string;
  number: string;
  origin: string;
  dest: string;
  /** itinerary day/month — the year is the next occurrence of that date */
  day: number;
  month: number;
  /** resolve the operating aircraft (when the source shows none) */
  needAircraft?: boolean;
  /** bare booking-class letter to resolve to a cabin */
  bookingClass?: string;
}

export interface AircraftLookupResult {
  aircraft: string | null; // e.g. "Airbus A380"
  equip: string | null; // Sabre equipment code, e.g. "380"
  confidence: "high" | "medium" | "low";
}

export interface CabinLookupResult {
  cabin: Cabin | null; // null when no reliable source exists
  reasoning: string; // e.g. "EY fare chart: W = Business Saver"
}

export interface OnlineLookupOutcome {
  aircraft: Map<string, AircraftLookupResult>;
  cabins: Map<string, CabinLookupResult>;
  /** true when the call used live Google Search grounding */
  grounded: boolean;
  /** true when a quota/billing 429 forced a retry WITHOUT grounding */
  usedFallback: boolean;
}

const LOOKUP_SYSTEM_PROMPT = `You are a flight resolver for a Sabre GDS converter. You receive a numbered list of
flights, each possibly missing one or both of:
- the AIRCRAFT type / equipment that operates it, and/or
- the CABIN for a bare booking-class letter (e.g. "W").

Resolve ONLY what each flight asks for. Never invent data — when no reliable
source exists, say so explicitly and return null.

CABIN rules:
- If the pasted text states an explicit cabin NAME (e.g. "Business", "First",
  "Premium Economy", "Economy"), that name is authoritative — return it and do
  NOT look anything up.
- If only a bare booking-class LETTER is given, resolve it against THAT
  AIRLINE'S OWN published fare chart, or a frequent-flyer partner's mileage
  earning table for that airline. A letter's meaning is airline-specific
  (e.g. Emirates "W" is Business; on many other carriers "W" is Economy).
  If no reliable source exists for that airline + letter, return cabin null and
  say "no reliable source found" in cabinReason. NEVER guess a cabin from
  generic IATA convention.

AIRCRAFT rules:
- If the pasted text already contains an aircraft type or equipment code, it is
  confirmed — return it and do NOT look anything up.
- Otherwise check 2-3 live trackers — FlightAware, Flightera, AirNavRadar,
  trip.com, flight.info — for the airline + flight number + route on the stated
  date. If the trackers disagree on dates/types (a fleet swap), return the most
  likely type but flag it "unverified best guess, confirm against PNR".

"sabreCode" is the 3-letter Sabre GDS equipment code this AIRLINE files for the
type. Standard examples: A380=380, A350-900=359, A350-1000=351, A330-300=333,
A330-200=332, A320=320, A321=321, A321neo=32N, 787-8=788, 787-9=789, 787-10=78J,
777-300ER=77W, 777-300=773, 767-300=763, 737-800=738, 737-900=739, 737 MAX 8=7M8,
737 MAX 9=7M9, E175=175, E195=E95, CRJ900=900, Q400=DH4. Airlines sometimes file
differently (e.g. Emirates files the Boeing 787-10 as 781); use the airline's own
practice when determinable, otherwise null.

"confidence" is "high" only when a dated schedule or two+ sources confirm the type
for this specific route; "medium" for the airline's standard equipment on the
route; "low" for a best guess.

Output a single JSON object, no prose:
{"results":[{"index":1,"aircraft":"Airbus A380","sabreCode":"380","confidence":"high",
"cabin":"BUSINESS","cabinReason":"EY fare chart: W = Business Saver"}]}
"aircraft"/"sabreCode"/"cabin"/"cabinReason" may be null or empty when not needed
or unknown.`;

const MONTH3 = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Normalize a display number to its raw digits ("022" -> "22"). */
function rawNum(num: string): string {
  const n = parseInt(num, 10);
  return Number.isFinite(n) ? String(n) : num;
}

/** One Gemini generateContent call for the lookup prompt. */
async function geminiLookupCall(
  model: string,
  apiKey: string,
  systemPrompt: string,
  userText: string,
  withGrounding: boolean
): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userText }] }],
      tools: withGrounding ? [{ google_search: {} }] : undefined,
      generationConfig: { temperature: 0 },
    }),
  });
  if (!res.ok) {
    const err = new Error(geminiError(res.status, await safeText(res))) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return Array.isArray(data?.candidates?.[0]?.content?.parts)
    ? data.candidates[0].content.parts.map((p: { text?: string }) => p.text || "").join("")
    : "";
}

/**
 * Ask the configured AI provider to resolve missing aircraft and/or
 * booking-class → cabin for the given flights — all in ONE call.
 * With Gemini this runs WITH Google Search grounding (a real online check) on
 * any supported model; a quota/billing 429 automatically retries once WITHOUT
 * grounding and reports which path was used. With OpenAI-compatible providers
 * it falls back to the model's own knowledge.
 */
export async function lookupFlightsOnline(
  items: OnlineLookupItem[],
  settings: AiSettings
): Promise<OnlineLookupOutcome> {
  if (!settings.apiKey) throw new Error("No API key configured.");
  const aircraft = new Map<string, AircraftLookupResult>();
  const cabins = new Map<string, CabinLookupResult>();
  if (items.length === 0) return { aircraft, cabins, grounded: false, usedFallback: false };

  const isGemini = settings.provider === "gemini";
  const model = settings.model || (isGemini ? "gemini-3.6-flash" : "gpt-4o-mini");
  let grounded = isGemini && GROUNDING_MODELS.has(model);
  let usedFallback = false;

  const list = items
    .map((f, i) => {
      const wants =
        f.needAircraft && f.bookingClass
          ? `need aircraft; booking class ${f.bookingClass}`
          : f.needAircraft
            ? "need aircraft"
            : `need cabin for booking class ${f.bookingClass}`;
      return `${i + 1}. ${f.airline} ${rawNum(f.number)}, ${f.origin} → ${f.dest}, ${f.day} ${MONTH3[f.month] ?? ""} — ${wants}`;
    })
    .join("\n");

  let content: string;
  if (isGemini) {
    try {
      content = await geminiLookupCall(model, settings.apiKey, LOOKUP_SYSTEM_PROMPT, `Flights:\n${list}`, grounded);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 429 && grounded) {
        // Quota/billing on the grounded call — retry once WITHOUT Google Search
        // grounding (the model's own knowledge still resolves most flights).
        usedFallback = true;
        grounded = false;
        content = await geminiLookupCall(model, settings.apiKey, LOOKUP_SYSTEM_PROMPT, `Flights:\n${list}`, false);
      } else {
        throw e;
      }
    }
  } else {
    const base = (settings.provider === "custom" && settings.baseUrl ? settings.baseUrl : "https://api.openai.com/v1").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: LOOKUP_SYSTEM_PROMPT },
          { role: "user", content: `Flights:\n${list}` },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await safeText(res)}`);
    const data = await res.json();
    content = data?.choices?.[0]?.message?.content ?? "";
  }
  if (!content) throw new Error("The AI returned no content.");

  const json = extractJson(content) as { results?: Array<{
    index?: number;
    aircraft?: string | null;
    sabreCode?: string | null;
    equipmentCode?: string | null;
    confidence?: string;
    cabin?: string | null;
    cabinReason?: string | null;
  }> };
  for (const r of json.results ?? []) {
    const item = items[(Number(r.index) || 1) - 1] ?? null;
    if (!item) continue;
    const key = `${item.airline}${rawNum(item.number)}`;

    if (item.needAircraft) {
      const acName = r.aircraft ? String(r.aircraft).trim() : "";
      const modelCode = String(r.sabreCode ?? r.equipmentCode ?? "").trim().toUpperCase();
      // The aircraft name goes through the SAME mapper the local parser uses,
      // so a phrase like "Boeing 787-10" is always converted identically; the
      // model's own sabreCode wins when it is a plausible 2-3 char GDS code.
      const mapped = acName ? parseExplicitAircraftString(acName, item.airline) : null;
      const code = (/^[A-Z0-9]{2,3}$/.test(modelCode) ? modelCode : null) ?? mapped ?? null;
      if (acName || code) {
        aircraft.set(key, {
          aircraft: acName || null,
          equip: code,
          confidence: r.confidence === "high" || r.confidence === "medium" ? r.confidence : "low",
        });
      }
    }

    if (item.bookingClass) {
      const cabin = normCabin(r.cabin ?? undefined) ?? null;
      const reasoning = r.cabinReason && String(r.cabinReason).trim()
        ? String(r.cabinReason).trim()
        : cabin
          ? "resolved online"
          : "no reliable source found";
      cabins.set(key, { cabin, reasoning });
    }
  }
  return { aircraft, cabins, grounded, usedFallback };
}
