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
  return "gemini-2.0-flash";
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
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await safeText(res)}`);
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
