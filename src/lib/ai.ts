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
import type { Cabin, ConverterResult, RawFlight } from "./types";
import { timeToMinutes } from "./aiTime";
import { findAircraftTokens, parseExplicitAircraftString } from "./aircraft";

export type AiProvider = "gemini" | "openai" | "custom";

export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  apiKey: string;
  model: string;
  baseUrl: string; // for "custom" (OpenAI-compatible)
  /** optional comma/newline separated extra models tried when the first is unavailable */
  fallbackModels?: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: "gemini",
  apiKey: "",
  model: "gemini-2.0-flash",
  baseUrl: "",
  fallbackModels: "",
};

export function defaultModelFor(provider: AiProvider): string {
  if (provider === "openai") return "gpt-4o-mini";
  if (provider === "custom") return "gpt-4o-mini";
  return "gemini-2.0-flash";
}

/** Built-in fallback chain used when the configured model is unavailable. */
export function builtInFallbackModels(provider: AiProvider): string[] {
  if (provider === "gemini") {
    return ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-flash-latest", "gemini-1.5-flash"];
  }
  if (provider === "openai") return ["gpt-4o-mini", "gpt-4o"];
  return [];
}

/** Ordered, de-duplicated list of models to try: configured first, then fallbacks. */
export function modelChain(s: AiSettings): string[] {
  const user = (s.fallbackModels ?? "")
    .split(/[,\n]/)
    .map((m) => m.trim())
    .filter(Boolean);
  const chain = [s.model || defaultModelFor(s.provider), ...user, ...builtInFallbackModels(s.provider)];
  const seen = new Set<string>();
  return chain.filter((m) => m && !seen.has(m) && (seen.add(m), true));
}

/* ------------------------------------------------------------------ */
/* transient API error handling (HTTP 503 & friends)                   */
/* ------------------------------------------------------------------ */

/**
 * An AI provider failure. `transient` marks overload/rate-limit/network
 * conditions (503 UNAVAILABLE, 429, 5xx, connection drops) that say nothing
 * about the itinerary itself and must never be reported as a parsing error.
 */
export class AiError extends Error {
  readonly status?: number;
  readonly transient: boolean;
  readonly model?: string;
  /** true when the key/permissions are wrong — retrying other models is pointless */
  readonly fatal: boolean;
  /** seconds requested by the provider's Retry-After header, when present */
  readonly retryAfterSec?: number;

  constructor(
    message: string,
    opts: {
      status?: number;
      transient?: boolean;
      model?: string;
      fatal?: boolean;
      retryAfterSec?: number;
    } = {}
  ) {
    super(message);
    this.name = "AiError";
    this.status = opts.status;
    this.transient = opts.transient ?? false;
    this.model = opts.model;
    this.fatal = opts.fatal ?? false;
    this.retryAfterSec = opts.retryAfterSec;
  }
}

/** Overloaded / rate-limited / temporarily broken — safe and useful to retry. */
/**
 * Should AI Assist run on its own for a result the local parser produced?
 *
 * The deterministic parser stays the first and authoritative pass; AI is only
 * a *fallback* for the situations the local rules genuinely cannot finish,
 * which the converter already reports on its result:
 *
 *   - equipment came back as "---"        (failedEquipmentFlights)
 *   - a "*" code-share flight with no operator resolved (failedOperatorFlights)
 *   - a booking-class letter that is neither confirmed nor learned
 *     (unknownClassQuestions)
 *
 * Pure and side-effect free, so the UI and the test suites share one rule.
 */
export function shouldAutoRunAi(result: ConverterResult | null | undefined): boolean {
  if (!result) return false;
  return (
    result.failedEquipmentFlights.length > 0 ||
    result.failedOperatorFlights.length > 0 ||
    result.unknownClassQuestions.length > 0
  );
}

export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

/** Wrong key or no access — retrying (any model) cannot help. */
function isFatalStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/** Model missing/unsupported for this key — skip to the next model in the chain. */
function isModelUnavailableStatus(status: number): boolean {
  return status === 404 || status === 400;
}

export interface AiAttemptInfo {
  model: string;
  attempt: number;
  status?: number;
  willRetryInMs?: number;
  message: string;
}

export interface AiRunOptions {
  /** max attempts per model (default 3) */
  attemptsPerModel?: number;
  /** base backoff delay in ms (default 700) */
  baseDelayMs?: number;
  /** progress/telemetry hook — lets the UI say "retrying…" instead of showing a raw 503 */
  onAttempt?: (info: AiAttemptInfo) => void;
  /** injectable sleep (tests) */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, honouring a Retry-After header when present. */
export function backoffDelay(attempt: number, base: number, retryAfterSec?: number): number {
  if (retryAfterSec !== undefined && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, 20000);
  const exp = base * Math.pow(2, attempt - 1);
  return Math.min(Math.round(exp + Math.random() * base), 20000);
}

function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers?.get?.("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
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

async function callGemini(text: string, s: AiSettings, model?: string): Promise<string> {
  const useModel = model || s.model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    useModel
  )}:generateContent?key=${encodeURIComponent(s.apiKey)}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0 },
      }),
    });
  } catch (e) {
    // network/DNS/CORS drop — transient, never an itinerary problem
    throw new AiError(e instanceof Error ? e.message : "Network error", {
      transient: true,
      model: useModel,
    });
  }
  if (!res.ok) {
    throw new AiError(`Gemini ${res.status}: ${await safeText(res)}`, {
      status: res.status,
      transient: isTransientStatus(res.status),
      fatal: isFatalStatus(res.status),
      model: useModel,
      retryAfterSec: parseRetryAfter(res),
    });
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const out = Array.isArray(parts) ? parts.map((p: { text?: string }) => p.text || "").join("") : "";
  if (!out) throw new AiError("Gemini returned no content.", { transient: true, model: useModel });
  return out;
}

async function callOpenAI(text: string, s: AiSettings, model?: string): Promise<string> {
  const base = (s.provider === "custom" && s.baseUrl ? s.baseUrl : "https://api.openai.com/v1").replace(/\/$/, "");
  const useModel = model || s.model || "gpt-4o-mini";
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.apiKey}`,
      },
      body: JSON.stringify({
        model: useModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text },
        ],
      }),
    });
  } catch (e) {
    throw new AiError(e instanceof Error ? e.message : "Network error", {
      transient: true,
      model: useModel,
    });
  }
  if (!res.ok) {
    throw new AiError(`OpenAI ${res.status}: ${await safeText(res)}`, {
      status: res.status,
      transient: isTransientStatus(res.status),
      fatal: isFatalStatus(res.status),
      model: useModel,
      retryAfterSec: parseRetryAfter(res),
    });
  }
  const data = await res.json();
  const out = data?.choices?.[0]?.message?.content;
  if (!out) throw new AiError("OpenAI returned no content.", { transient: true, model: useModel });
  return out;
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

/**
 * Call the provider with automatic recovery from transient failures.
 *
 * Order of events for a model:
 *   attempt 1 → 503 UNAVAILABLE → wait (exponential backoff + jitter)
 *   attempt 2 → 503            → wait longer
 *   attempt 3 → 503            → give up on THIS model, try the next one
 * When every model is exhausted the last transient error is reported as
 * "AI Assist is temporarily unavailable", never as an itinerary problem.
 */
export async function callModelWithRetry(
  text: string,
  settings: AiSettings,
  opts: AiRunOptions = {}
): Promise<{ content: string; model: string }> {
  const attemptsPerModel = Math.max(1, opts.attemptsPerModel ?? 3);
  const baseDelay = opts.baseDelayMs ?? 700;
  const sleep = opts.sleep ?? defaultSleep;
  const models = modelChain(settings);

  let lastError: AiError | null = null;

  for (const model of models) {
    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      try {
        const content =
          settings.provider === "gemini"
            ? await callGemini(text, settings, model)
            : await callOpenAI(text, settings, model);
        return { content, model };
      } catch (e) {
        const err =
          e instanceof AiError
            ? e
            : new AiError(e instanceof Error ? e.message : String(e), { model, transient: false });
        lastError = err;

        // wrong key / no access: stop everything, nothing else can succeed
        if (err.fatal) throw err;

        // model not available for this key: move straight to the next model
        if (err.status !== undefined && isModelUnavailableStatus(err.status)) {
          opts.onAttempt?.({
            model,
            attempt,
            status: err.status,
            message: `Model "${model}" is unavailable — trying the next model.`,
          });
          break;
        }

        if (!err.transient) throw err;

        const isLastAttempt = attempt === attemptsPerModel;
        if (isLastAttempt) {
          opts.onAttempt?.({
            model,
            attempt,
            status: err.status,
            message: `"${model}" is busy — trying the next model.`,
          });
          break;
        }
        const wait = backoffDelay(attempt, baseDelay, err.retryAfterSec);
        opts.onAttempt?.({
          model,
          attempt,
          status: err.status,
          willRetryInMs: wait,
          message: `AI is busy (${err.status ?? "network"}) — retrying in ${Math.round(wait / 100) / 10}s…`,
        });
        await sleep(wait);
      }
    }
  }

  throw new AiError(
    "AI Assist is temporarily unavailable — the model is overloaded right now. Your itinerary is fine; try again shortly or use the local parser result.",
    { status: lastError?.status, transient: true, model: lastError?.model }
  );
}

/** Send text to the configured AI provider and return structured flights. */
export async function extractFlightsWithAI(
  text: string,
  settings: AiSettings,
  opts: AiRunOptions = {}
): Promise<RawFlight[]> {
  if (!settings.apiKey) throw new AiError("No API key configured.", { fatal: true });
  const { content } = await callModelWithRetry(text, settings, opts);
  let json: { flights?: AiFlightJson[] };
  try {
    json = extractJson(content) as { flights?: AiFlightJson[] };
  } catch {
    // A malformed reply is an AI problem, not an itinerary problem, and it must
    // never produce partial or invented segments.
    throw new AiError("The AI returned a malformed response — no segments were generated.", {
      transient: true,
    });
  }
  const flights = toRawFlights(json);
  if (flights.length === 0) throw new AiError("The AI did not find any flights in that text.");
  return flights;
}
