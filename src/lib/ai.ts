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
import type { Cabin, ConverterResult, Issue, ParsedDate, RawFlight, Segment } from "./types";
import { timeToMinutes } from "./aiTime";
import { findAircraftTokens, parseExplicitAircraftString } from "./aircraft";
import { inferRouteEquipment, lookupKnownFlight } from "./knownFlights";

export type AiProvider = "gemini" | "openai" | "custom";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string; // for "custom" (OpenAI-compatible)
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "gemini",
  apiKey: "",
  model: "gemini-2.0-flash",
  baseUrl: "",
};

export function defaultModelFor(provider: AiProvider): string {
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "custom") return "gpt-4o-mini";
  return "gemini-1.5-flash";
}

export function sanitizeModel(provider: AiProvider, model: string): string {
  const m = (model || "").trim();
  if (provider === "gemini") {
    const valid = [
      "gemini-1.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-2.0-pro-exp-02-05",
    ];
    if (valid.includes(m)) return m;
    return "gemini-1.5-flash";
  }
  if (provider === "openai") {
    const valid = ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"];
    if (valid.includes(m)) return m;
    return "gpt-4o-mini";
  }
  return m || defaultModelFor(provider);
}

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
- cabin is one of FIRST, BUSINESS, PREMIUM, ECONOMY. bookingClass is the single
  letter if the source states one (e.g. "Business (P)" -> "P"), else "".
- operatedBy: the operator name if the source states "Operated by X" or codeshare info.
  IF THE OPERATOR IS NOT STATED in the source for a codeshare or flight with '*' flag,
  USE ONLINE LOOKUP (Google Search / flight status) to determine the actual operating carrier (e.g. Air Canada, Lufthansa, Air France, IndiGo, Horizon Air).
- hasStarFlag: true if the segment in the source has an asterisk '*' flag (e.g. "AF*3775", "DL*8727", "UA*8466"), else false.
- Preserve source order; it is usually outbound flights first, then the return.
- Do NOT invent data. If a field is truly absent, use "" (or null).

- durationMinutes: the flight's OWN block/elapsed time in MINUTES, exactly as
  printed for that flight (e.g. "(1h 27m)" -> 87, "(13h 20m)" -> 800,
  "3h 0m" -> 180). NEVER use a layover/connection duration ("Layover in PHL
  (2h 0m)") — that belongs to the connection, not to any flight. If the flight
  itself shows no duration, use null.
- aircraft: copy the aircraft text if printed in the source (e.g. "Embraer ERJ-145",
  "Airbus A321neo", "Boeing 737 MAX 9 Passenger").
  IF THE AIRCRAFT IS NOT STATED in the source (e.g. codeshares, schedules without equipment),
  USE ONLINE LOOKUP (Google Search / flight status) to find the scheduled aircraft type
  for that flight number and route (e.g. Boeing 777-300ER, Airbus A350-900, Airbus A220-300,
  Boeing 787-9, Boeing 747-8, Airbus A320). Only leave "" if lookup yields no result.

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
  hasStarFlag?: boolean;
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

function parseDateField(d: AiFlightJson["date"]): ParsedDate | null {
  if (!d) return null;
  if (typeof d === "object") {
    const day = Number(d.day);
    const month = Number(d.month);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return { day, month };
    return null;
  }
  // strings like "02MAR", "9NOV", "Nov 9", "11/09", "2025-11-09"
  const s = String(d).trim();
  let m = /^(\d{1,2})\s*([A-Za-z]{3,})/.exec(s);
  if (m) {
    const mo = MONTHS_ABBR[m[2].slice(0, 3).toLowerCase()];
    if (mo) {
      const raw = m[1].length === 2 ? `${m[1]}${m[2].slice(0, 3).toUpperCase()}` : undefined;
      return { day: parseInt(m[1], 10), month: mo, raw };
    }
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
    let equip = acExplicit ?? acTok?.equip ?? undefined;

    // The flight's own duration, if the model reported one.
    const elapsed =
      parseDurationField(j.durationMinutes) ??
      parseDurationField(j.duration) ??
      parseDurationField(j.elapsedMinutes);

    let operatedBy = j.operatedBy ? j.operatedBy.toUpperCase().trim() : undefined;

    // Check known-flight table before giving up on operator or equipment
    const known = lookupKnownFlight(airline, number, origin, dest);
    if (known) {
      if (!operatedBy) operatedBy = known.operator;
      if (!equip || equip === "---") equip = known.equip;
    }
    if (!equip || equip === "---") {
      const inferred = inferRouteEquipment(airline, origin, dest, operatedBy);
      if (inferred) equip = inferred;
    }

    const hasStarFlag =
      j.hasStarFlag === true ||
      (typeof j.flightNumber === "string" && j.flightNumber.includes("*")) ||
      false;

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
      hasStarFlag,
      operatedBy,
      order: i,
    });
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* Provider calls                                                      */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableError(err: unknown): boolean {
  if (!err) return false;
  const status = (err as { status?: number }).status;
  if (status === 503 || status === 429 || status === 500 || status === 502 || status === 504 || status === 404) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("unavailable") ||
    msg.includes("resource_exhausted") ||
    msg.includes("resource has been exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("timeout") ||
    msg.includes("abort") ||
    msg.includes("etimedout") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
}

async function callGemini(text: string, s: AiSettings): Promise<string> {
  const primaryModel = sanitizeModel("gemini", s.model);
  const modelsToTry = Array.from(new Set([primaryModel, "gemini-1.5-flash", "gemini-2.0-flash"]));

  let lastError: unknown;
  for (const model of modelsToTry) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(s.apiKey)}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      // 1. Try with search grounding tool for live web flight data
      let res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0 },
        }),
      });

      // 2. If tools are unsupported on key or tier (400), try standard json mode
      if (!res.ok && res.status === 400) {
        res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0 },
          }),
        });
      }

      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts;
        const out = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || "").join("") : "";
        if (out) return out;
      } else {
        const errBody = await safeText(res);
        lastError = new Error(`Gemini ${res.status} (${model}): ${errBody}`);
        if (res.status === 429 || res.status === 503) {
          throw lastError; // propagate for backoff retry
        }
      }
    } catch (err) {
      lastError = err;
      if (isRetryableError(err)) {
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Gemini extraction failed."));
}

async function callOpenAI(text: string, s: AiSettings): Promise<string> {
  const base = (s.provider === "custom" && s.baseUrl ? s.baseUrl : "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.apiKey}`,
      },
      signal: controller.signal,
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
    if (!res.ok) {
      const errBody = await safeText(res);
      const err = new Error(`OpenAI ${res.status}: ${errBody}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const data = await res.json();
    const out = data?.choices?.[0]?.message?.content;
    if (!out) throw new Error("OpenAI returned no content.");
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
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

async function fetchWithRetry(
  text: string,
  settings: AiSettings,
  onStatus?: (msg: string) => void
): Promise<string> {
  const delays = [2000, 5000, 10000];
  const primarySettings = { ...settings };
  let fallbackSettings: AiSettings | null = null;

  if (settings.provider === "gemini") {
    const fallbackModel =
      settings.model === "gemini-1.5-flash" ? "gemini-2.0-flash" : "gemini-1.5-flash";
    fallbackSettings = { ...settings, model: fallbackModel };
  } else if (settings.provider === "openai") {
    const fallbackModel = settings.model === "gpt-4o" ? "gpt-4o-mini" : "gpt-4o";
    fallbackSettings = { ...settings, model: fallbackModel };
  }

  const callProvider = (s: AiSettings) =>
    s.provider === "gemini" ? callGemini(text, s) : callOpenAI(text, s);

  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await callProvider(primarySettings);
    } catch (err) {
      lastError = err;
      if (attempt < delays.length && isRetryableError(err)) {
        onStatus?.("Retrying lookup...");
        await sleep(delays[attempt]);
        continue;
      }
      break;
    }
  }

  if (fallbackSettings) {
    onStatus?.("Retrying lookup...");
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      try {
        return await callProvider(fallbackSettings);
      } catch (err) {
        lastError = err;
        if (attempt < delays.length && isRetryableError(err)) {
          onStatus?.("Retrying lookup...");
          await sleep(delays[attempt]);
          continue;
        }
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "AI extraction failed."));
}

/** Send text to the configured AI provider and return structured flights. */
export async function extractFlightsWithAI(
  text: string,
  settings: AiSettings,
  onStatus?: (status: string) => void
): Promise<RawFlight[]> {
  if (!settings.apiKey) throw new Error("No API key configured.");
  const content = await fetchWithRetry(text, settings, onStatus);
  const json = extractJson(content) as { flights?: AiFlightJson[] };
  const flights = toRawFlights(json);
  if (flights.length === 0) throw new Error("The AI did not find any flights in that text.");
  return flights;
}

/**
 * Determines whether the AI assist step should automatically run
 * when "Enable AI Assist" is active.
 *
 * Conditions:
 * 1. Any segment has equip "---" (equipment lookup failed / missing)
 * 2. Segment has star flag (*) and text doesn't name an operator
 * 3. Airline + class letter pair is not confirmed or learned
 * 4. Parser held back segments due to incomplete data
 */
export function shouldAutoRunAi(res: ConverterResult): boolean {
  if (res.segments.length === 0) return false;
  if (res.failedEquipmentFlights && res.failedEquipmentFlights.length > 0) return true;
  if (res.failedOperatorFlights && res.failedOperatorFlights.length > 0) return true;
  if (res.unknownClassQuestions && res.unknownClassQuestions.length > 0) return true;
  if (res.segments.some((s: Segment) => s.equip === "---")) return true;
  if (res.segments.some((s: Segment) => s.hasStarFlag && !s.operatedBy)) return true;
  if (
    res.issues.some(
      (i: Issue) =>
        i.text.toLowerCase().includes("held back") ||
        i.text.toLowerCase().includes("incomplete")
    )
  ) {
    return true;
  }
  return false;
}
