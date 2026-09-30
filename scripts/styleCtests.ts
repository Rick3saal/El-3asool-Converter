/**
 * Google Flights / Style C + transient-AI-error regression suite.
 *
 * Covers the targeted corrections:
 *   1-3. Style C operator handling (explicit-only, per leg, no external lookup)
 *   4.   per-leg cabin / booking-class defaults
 *   5.   Akasa Air (QP) "Boeing 737MAX 8" -> 7M8, never an extra segment
 *   6-7. Style C segment parsing (airline / cabin / aircraft / flight number)
 *   8.   Matrix / ITA behaviour unchanged
 *   9.   local parser stays primary
 *   10.  Gemini 503 retry + fallback + clear messaging
 *   12.  the required BA MSP→ORD→LHR→BOM→LHR→DFW→MSP scenario
 *
 * Usage: npx tsx scripts/styleCtests.ts
 */
import { convertToSabre } from "../src/lib/converter";
import { enforceConnectionDates } from "../src/lib/dates";
import type { RawFlight } from "../src/lib/types";
import { parseItineraryText } from "../src/lib/parser";
import { isGoogleFlightsStyleC, parseGoogleFlightsStyleC } from "../src/lib/googleflights";
import { parseExplicitAircraftString, findAircraftTokens } from "../src/lib/aircraft";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}
const convert = (t: string) => convertToSabre(t, null);

/* ================================================================== */
/* 12. REQUIRED TEST CASE — BA Style C round trip                      */
/* ================================================================== */
{
  console.log("\n[Style C · required] BA 6597/296/135/138/1590/2409");
  const input = `Departing flight Tue, Oct 20

6:00 AM
Minneapolis-Saint Paul International Airport (MSP)

7:30 AM
Chicago O'Hare International Airport (ORD)

British Airways 6597

Business

Operated by Republic Airways AS American Eagle For American Airlines

1 hr 30 min layover
Chicago (ORD)

9:00 AM
Chicago O'Hare International Airport (ORD)

11:00 PM
London Heathrow Airport (LHR)

British Airways 296

Business

2 hr layover
London (LHR)

1:00 AM
London Heathrow Airport (LHR)

2:30 PM
Chhatrapati Shivaji International Airport (BOM)

British Airways 135

Business

Returning flight Tue, Nov 3

4:00 AM
Chhatrapati Shivaji International Airport (BOM)

8:30 AM
London Heathrow Airport (LHR)

British Airways 138

Business

3 hr layover
London (LHR)

11:30 AM
London Heathrow Airport (LHR)

4:00 PM
Dallas Fort Worth International Airport (DFW)

British Airways 1590

Business

Operated by American Airlines

2 hr layover
Dallas (DFW)

6:00 PM
Dallas Fort Worth International Airport (DFW)

8:30 PM
Minneapolis-Saint Paul International Airport (MSP)

British Airways 2409

Business

Operated by American Airlines`;

  const r = convert(input);
  const seg = (n: string) => r.segments.find((s) => s.num === n);

  check("exactly 6 segments", r.segments.length === 6, `got ${r.segments.length}`);
  check(
    "every leg keeps the MARKETING carrier BA",
    r.segments.every((s) => s.airline === "BA"),
    r.segments.map((s) => s.airline).join(",")
  );
  check(
    "flight numbers in order",
    r.segments.map((s) => s.num).join(",") === "6597,296,135,138,1590,2409",
    r.segments.map((s) => s.num).join(",")
  );

  // explicit operator statements -> operated-by line
  check("BA 6597 has the explicit operator", seg("6597")?.operatedBy === "REPUBLIC AIRWAYS AS AMERICAN EAGLE FOR AMERICAN AIRLINES", String(seg("6597")?.operatedBy));
  check("BA 1590 operated by American Airlines", seg("1590")?.operatedBy === "AMERICAN AIRLINES", String(seg("1590")?.operatedBy));
  check("BA 2409 operated by American Airlines", seg("2409")?.operatedBy === "AMERICAN AIRLINES", String(seg("2409")?.operatedBy));

  // no explicit statement -> NO operated-by line, and no external lookup
  check("BA 296 has NO operated-by", seg("296")?.operatedBy === undefined, String(seg("296")?.operatedBy));
  check("BA 135 has NO operated-by", seg("135")?.operatedBy === undefined, String(seg("135")?.operatedBy));
  check("BA 138 has NO operated-by", seg("138")?.operatedBy === undefined, String(seg("138")?.operatedBy));

  const opLines = r.itinerary.split("\n").filter((l) => l.includes("OPERATED BY"));
  check("exactly 3 operated-by lines in the output", opLines.length === 3, opLines.join(" | "));
  check("operated-by lines are the right ones", opLines.join("\n") === `*MSP-ORD OPERATED BY REPUBLIC AIRWAYS AS AMERICAN EAGLE FOR AMERICAN AIRLINES
*LHR-DFW OPERATED BY AMERICAN AIRLINES
*DFW-MSP OPERATED BY AMERICAN AIRLINES`, opLines.join("\n"));
  check(
    "no operated-by line anywhere near BA 296 / 135 / 138",
    !r.itinerary.includes("*ORD-LHR OPERATED") &&
      !r.itinerary.includes("*LHR-BOM OPERATED") &&
      !r.itinerary.includes("*BOM-LHR OPERATED"),
    r.itinerary
  );
  check("routing read per leg", r.segments.map((s) => `${s.origin}-${s.dest}`).join(",") === "MSP-ORD,ORD-LHR,LHR-BOM,BOM-LHR,LHR-DFW,DFW-MSP", r.segments.map((s) => `${s.origin}-${s.dest}`).join(","));
  check("outbound/inbound split 3/3", r.segments.filter((s) => s.direction === "OUT").length === 3 && r.segments.filter((s) => s.direction === "IN").length === 3, JSON.stringify(r.segments.map((s) => s.direction)));
  check("business default class J on every leg", r.segments.every((s) => s.bookingClass === "J" && s.cabin === "BUSINESS"));
  check("no error issues", r.issues.filter((i) => i.level === "error").length === 0, JSON.stringify(r.issues));
}

/* ================================================================== */
/* 6 & 7. Style C segment parsing: airline / cabin / aircraft / number */
/* ================================================================== */
{
  console.log("\n[Style C · segments] Discover 4Y 81 + Lufthansa LH 2306");
  const input = `Departing flightTue, Oct 20

9:45 PM
Orlando International Airport (MCO)

1:20 PM +1
Munich International Airport (MUC)

Discover Airlines

Business Class

Airbus A330

4Y 81

1 hr 25 min layover
Munich (MUC)

2:45 PM +1

Munich International Airport (MUC)

4:20 PM +1

Amsterdam Airport Schiphol (AMS)

Lufthansa

Business Class

Airbus A320

LH 2306`;
  const r = convert(input);
  check("exactly 2 segments", r.segments.length === 2, `got ${r.segments.length}: ${r.segments.map((s) => s.airline + s.num).join(",")}`);
  check("segment 1 = 4Y 81 MCO-MUC", r.itinerary.includes("1 4Y 81 20OCT MCO MUC"), r.itinerary);
  check("segment 2 = LH 2306 MUC-AMS", r.itinerary.includes("2 LH 2306 21OCT MUC AMS"), r.itinerary);
  check("aircraft A330 -> 330 on leg 1", r.segments[0]?.equip === "330", String(r.segments[0]?.equip));
  check("aircraft A320 -> 320 on leg 2", r.segments[1]?.equip === "320", String(r.segments[1]?.equip));
  check("aircraft never became a segment", !r.segments.some((s) => s.airline === "A3" || /^A\d/.test(s.airline)));
  check("layover never became a segment", r.segments.length === 2);
  check("per-leg cabin business on both", r.segments.every((s) => s.cabin === "BUSINESS"));
  check("no operated-by invented", r.segments.every((s) => s.operatedBy === undefined), JSON.stringify(r.segments.map((s) => s.operatedBy)));
  check("+1 day offset on leg 1 arrival", r.itinerary.includes("945P 120P¥1"), r.itinerary);
  check("leg 2 date rolled to 21OCT via '+1'", r.segments[1]?.date.day === 21 && r.segments[1]?.date.month === 10, JSON.stringify(r.segments[1]?.date));
}

/* ================================================================== */
/* 3. self-operated flights: EY 10 / EY 205 / QP 585                   */
/* ================================================================== */
{
  console.log("\n[Style C · self-operated] Etihad + Akasa, no operator statement");
  const input = `Departing flight Tue, Oct 20

9:00 AM
John F. Kennedy International Airport (JFK)

8:30 AM +1
Zayed International Airport (AUH)

Etihad

Business Class

Boeing 787

EY 10

2 hr layover
Abu Dhabi (AUH)

10:30 AM +1
Zayed International Airport (AUH)

3:20 PM +1
Chhatrapati Shivaji International Airport (BOM)

Etihad

Business Class

Airbus A320

EY 205

3 hr layover
Mumbai (BOM)

6:20 PM +1
Chhatrapati Shivaji International Airport (BOM)

8:30 PM +1
Indira Gandhi International Airport (DEL)

Akasa Air

Economy

Boeing 737MAX 8

QP 585`;
  const r = convert(input);
  check("3 segments", r.segments.length === 3, `got ${r.segments.length}`);
  check("EY 10 present", r.segments.some((s) => s.airline === "EY" && s.num === "10"));
  check("EY 205 present", r.segments.some((s) => s.airline === "EY" && s.num === "205"));
  check("QP 585 present", r.segments.some((s) => s.airline === "QP" && s.num === "585"));
  check("NO operated-by line anywhere", !r.itinerary.includes("OPERATED BY"), r.itinerary);
  check("no operator on any segment", r.segments.every((s) => s.operatedBy === undefined));
  check("QP leg uses QP cabin default Y", r.segments.find((s) => s.airline === "QP")?.bookingClass === "Y");
  check("EY legs use business default J", r.segments.filter((s) => s.airline === "EY").every((s) => s.bookingClass === "J"));
  check("Boeing 737MAX 8 -> 7M8", r.segments.find((s) => s.airline === "QP")?.equip === "7M8", String(r.segments.find((s) => s.airline === "QP")?.equip));
}

/* ================================================================== */
/* 5. equipment table: Akasa Air (QP) Boeing 737MAX 8 -> 7M8           */
/* ================================================================== */
{
  console.log("\n[Equipment] Boeing 737MAX 8 -> 7M8");
  check("explicit 'Boeing 737MAX 8' -> 7M8", parseExplicitAircraftString("Boeing 737MAX 8", "QP") === "7M8");
  check("explicit 'Boeing 737MAX8' -> 7M8", parseExplicitAircraftString("Boeing 737MAX8", "QP") === "7M8");
  check("bare '737MAX 8' -> 7M8", parseExplicitAircraftString("737MAX 8", "QP") === "7M8");
  check("token scan finds 'Boeing 737MAX 8'", findAircraftTokens("Boeing 737MAX 8")[0]?.equip === "7M8");
  check("token scan finds bare '737MAX 8'", findAircraftTokens("737MAX 8")[0]?.equip === "7M8");
  check(
    "aircraft description never creates a segment",
    parseItineraryText("Boeing 737MAX 8\nAirbus A330\nBoeing 787").flights.length === 0,
    JSON.stringify(parseItineraryText("Boeing 737MAX 8").flights)
  );
}

/* ================================================================== */
/* 1-2. explicit operator variants                                     */
/* ================================================================== */
{
  console.log("\n[Style C · operator variants] 'Plane and crew by'");
  const input = `Departing flight Tue, Oct 20

6:00 AM
Minneapolis-Saint Paul International Airport (MSP)

7:30 AM
Chicago O'Hare International Airport (ORD)

British Airways 6597

Business

Plane and crew by Republic Airways as American Eagle`;
  const r = convert(input);
  check("1 segment", r.segments.length === 1, `got ${r.segments.length}`);
  check("marketing carrier stays BA 6597", r.segments[0]?.airline === "BA" && r.segments[0]?.num === "6597");
  check("'Plane and crew by' produces the operator", r.segments[0]?.operatedBy === "REPUBLIC AIRWAYS AS AMERICAN EAGLE", String(r.segments[0]?.operatedBy));
  check("operated-by line rendered", r.itinerary.includes("*MSP-ORD OPERATED BY REPUBLIC AIRWAYS AS AMERICAN EAGLE"), r.itinerary);
}

/* ================================================================== */
/* 8 & 11. Matrix / ITA and existing layouts unchanged                 */
/* ================================================================== */
{
  console.log("\n[Matrix/ITA] existing behaviour untouched");

  // Style C detection must not claim Matrix text
  const matrix = `Milan (LIN) to Casablanca (CMN)

Lufthansa 273
Airbus A320
Business (J)

Layover in FRA

Lufthansa 1330
Airbus A320neo
Business (J)`;
  check("Matrix text is NOT treated as Style C", !isGoogleFlightsStyleC(matrix));
  check("Style C reader declines Matrix text", parseGoogleFlightsStyleC(matrix) === null);

  // a classic Google-Flights-ish block the old parser already handled
  const classic = `Round-trip, 1 traveler
New York → Cairo
Egyptair
Wed, Nov 4
Egyptair 988 · Boeing 787-9 Dreamliner
10:40 PM JFK → 11:20 AM +1 CAI
Business (J)
Nonstop · 10 hr 40 min`;
  check("classic block is NOT hijacked by Style C", !isGoogleFlightsStyleC(classic));
  const rc = convert(classic);
  check("classic block still converts", rc.itinerary.includes("1 MS 988 4NOV JFK CAI 1040P 1120A¥1 789"), rc.itinerary);

  // Sabre fast path untouched
  const sabre = `1 BA 085 31DEC LHR EWR 1040A 150P 777 8.10 0 N  CABIN-BUSINESS`;
  check("Sabre block is NOT treated as Style C", !isGoogleFlightsStyleC(sabre));
}

/* ================================================================== */
/* 9. local parser stays primary                                       */
/* ================================================================== */
{
  console.log("\n[Local first] deterministic parser handles Style C without AI");
  const input = `Departing flight Tue, Oct 20

6:00 AM
Minneapolis-Saint Paul International Airport (MSP)

7:30 AM
Chicago O'Hare International Airport (ORD)

British Airways 6597

Business`;
  const p = parseItineraryText(input);
  check("local parser returns a complete leg (no AI needed)", p.flights.length === 1 && !!p.flights[0].origin && !!p.flights[0].dest && p.flights[0].dep !== undefined && p.flights[0].arr !== undefined, JSON.stringify(p.flights));
  const r = convert(input);
  check("conversion produces output with no error issues", r.hasOutput && r.issues.filter((i) => i.level === "error").length === 0, JSON.stringify(r.issues));
}

/* ================================================================== */
/* 10. Gemini 503 -> retry, fallback model, clear message              */
/* ================================================================== */
{
  console.log("\n[AI 503] transient errors retry, fall back, and never look like parse errors");
  const { callModelWithRetry, extractFlightsWithAI, AiError, isTransientStatus, backoffDelay, modelChain } =
    await import("../src/lib/ai");

  check("503 classified transient", isTransientStatus(503));
  check("429 classified transient", isTransientStatus(429));
  check("500 classified transient", isTransientStatus(500));
  check("400 NOT transient", !isTransientStatus(400));
  check("backoff grows", backoffDelay(2, 700) > backoffDelay(1, 700) - 1);
  check("Retry-After honoured", backoffDelay(1, 700, 3) === 3000);

  const settings = {
    enabled: true,
    provider: "gemini" as const,
    apiKey: "test-key",
    model: "gemini-2.5-pro",
    baseUrl: "",
    fallbackModels: "gemini-2.0-flash",
    searchOnline: false, // not exercised by these retry/model-chain tests
  };
  check("model chain starts with the configured model", modelChain(settings)[0] === "gemini-2.5-pro", modelChain(settings).join(","));
  check("model chain includes the user fallback", modelChain(settings).includes("gemini-2.0-flash"));

  const realFetch = globalThis.fetch;
  const noSleep = async () => {};

  // A. always 503 -> friendly "temporarily unavailable", never a parse error
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(
        JSON.stringify({ error: { code: 503, status: "UNAVAILABLE", message: "This model is currently experiencing high demand." } }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    let err: unknown = null;
    try {
      await callModelWithRetry("some itinerary", settings, { sleep: noSleep, attemptsPerModel: 2 });
    } catch (e) {
      err = e;
    }
    globalThis.fetch = realFetch;
    check("persistent 503 throws AiError", err instanceof AiError, String(err));
    check("persistent 503 is marked transient", (err as InstanceType<typeof AiError>)?.transient === true);
    check("message says temporarily unavailable", /temporarily unavailable/i.test((err as Error)?.message ?? ""), (err as Error)?.message);
    check("message does NOT blame the itinerary", !/itinerary parsing|invalid itinerary|could not parse/i.test((err as Error)?.message ?? ""));
    check("retried across attempts and models", calls >= 4, `calls=${calls}`);
  }

  // B. 503 once, then success -> recovers silently
  {
    let calls = 0;
    const notes: string[] = [];
    globalThis.fetch = (async () => {
      calls++;
      if (calls === 1) return new Response("{}", { status: 503 });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      flights: [
                        { airline: "BA", flightNumber: "296", origin: "ORD", destination: "LHR", date: { day: 20, month: 10 }, departure: "09:00", arrival: "23:00", cabin: "BUSINESS" },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;
    const flights = await extractFlightsWithAI("text", settings, {
      sleep: noSleep,
      onAttempt: (i) => notes.push(i.message),
    });
    globalThis.fetch = realFetch;
    check("recovers after one 503", flights.length === 1 && flights[0].airline === "BA", JSON.stringify(flights));
    check("user saw a retry note, not a raw error", notes.some((n) => /busy|retrying/i.test(n)), JSON.stringify(notes));
  }

  // C. model 404 -> next model in the chain is used
  {
    let calls = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      calls++;
      const u = String(url);
      if (u.includes("gemini-2.5-pro")) return new Response("{}", { status: 404 });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ flights: [{ airline: "EY", flightNumber: "10", origin: "JFK", destination: "AUH", date: { day: 20, month: 10 }, departure: "09:00", arrival: "08:30", arrivalDayOffset: 1, cabin: "BUSINESS" }] }) }] } }] }),
        { status: 200 }
      );
    }) as typeof fetch;
    const flights = await extractFlightsWithAI("text", settings, { sleep: noSleep });
    globalThis.fetch = realFetch;
    check("unavailable model skipped, fallback used", flights[0]?.airline === "EY", JSON.stringify(flights));
    check("404 model not retried repeatedly", calls <= 3, `calls=${calls}`);
  }

  // D. 401 -> fatal, no pointless retries
  {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("{}", { status: 401 });
    }) as typeof fetch;
    let err: unknown = null;
    try {
      await callModelWithRetry("t", settings, { sleep: noSleep });
    } catch (e) {
      err = e;
    }
    globalThis.fetch = realFetch;
    check("401 is fatal", (err as InstanceType<typeof AiError>)?.fatal === true);
    check("401 tried exactly once", calls === 1, `calls=${calls}`);
  }

  // E. AI failure never fabricates segments
  {
    globalThis.fetch = (async () => new Response("{}", { status: 503 })) as typeof fetch;
    let err: unknown = null;
    let flights: unknown = null;
    try {
      flights = await extractFlightsWithAI("t", settings, { sleep: noSleep, attemptsPerModel: 1 });
    } catch (e) {
      err = e;
    }
    globalThis.fetch = realFetch;
    check("no flights invented on failure", flights === null && err !== null);
  }
}

/* ================================================================== */
/* OVERNIGHT CONNECTIONS — a leg can never depart before the previous  */
/* one lands (card prints the journey date once, per-leg clocks only)  */
/* ================================================================== */
{
  console.log("\n[Style C · dates] BA BOM-LAX round trip: LHR-BOM rolls to 18MAR");
  const input = `Mumbai to Los Angeles

Round-trip, 1 Traveler

British Airways

BOM → LAX

Wed, Oct 21

1 stop • 23h 10m

9:30 am - 3:00 pm(10h 00m)

Chhatrapati Shivaji Intl (BOM) - Heathrow (LHR)

British Airways 134

Business

Wide-body jet

Boeing 777

1h 55m•Change planes in London (LHR)

4:55 pm - 8:10 pm(11h 15m)

Heathrow (LHR) - Los Angeles (LAX)

British Airways 1609

Business

Operated by American Airlines

Wide-body jet

Boeing 777-300ER

British Airways

LAX → BOM

Wed, Mar 17

1 stop • 21h 45m

7:25 pm - 1:05 pm(10h 40m)

Arrives Thu, Mar 18

Los Angeles (LAX) - Heathrow (LHR)

Overnight flight

British Airways 1509

Business

Operated by American Airlines

Wide-body jet

Boeing 787-9 Dreamliner

2h 00m•Change planes in London (LHR)

3:05 pm - 5:40 am(9h 05m)

Arrives Fri, Mar 19

Heathrow (LHR) - Chhatrapati Shivaji Intl (BOM)

Overnight flight

British Airways 135

Business

Wide-body jet

Boeing 787-8 Dreamliner`;
  const r = convert(input);
  check(
    "itinerary + additional",
    r.itinerary ===
      `1 BA 134 21OCT BOM LHR 930A 300P 777 10.00 0 N  CABIN-BUSINESS
2 BA 1609 21OCT LHR LAX 455P 810P 77W 11.15 0 N  CABIN-BUSINESS
*LHR-LAX OPERATED BY AMERICAN AIRLINES
3 BA 1509 17MAR LAX LHR 725P 105P¥1 789 10.40 0 N  CABIN-BUSINESS
*LAX-LHR OPERATED BY AMERICAN AIRLINES
4 BA 135 18MAR LHR BOM 305P 540A¥1 788 9.05 0 N  CABIN-BUSINESS

<--additional-->
1 BA 134J 21OCT
2 BA 1609J 21OCT
3 BA 1509J 17MAR
4 BA 135J 18MAR`,
    r.itinerary
  );
  check("outbound chain", r.outbound === "0BA134J21OCTBOMLHRNN1§0BA1609J21OCTLHRLAXNN1", r.outbound);
  check("return chain", r.inbound === "0BA1509J17MARLAXLHRNN1§0BA135J18MARLHRBOMNN1", r.inbound);
  check(
    "individual sells",
    r.individual ===
      `0BA134J21OCTBOMLHRGK1
0BA1609J21OCTLHRLAXGK1
0BA1509J17MARLAXLHRGK1
0BA135J18MARLHRBOMGK1`,
    r.individual
  );
  check("same-day connection untouched (21OCT)", !/BA 1609 22OCT/.test(r.itinerary), r.itinerary);
}

{
  console.log("\n[Style C · dates] connection dated from the printed layover time");
  // No per-leg dates and no 'Arrives' line: the connection is dated from the
  // previous leg's landing, which is the next day after a red-eye.
  const input = `Departing flight Wed, Mar 17

LAX → BOM

7:25 pm - 1:05 pm(10h 40m)

Los Angeles (LAX) - Heathrow (LHR)

British Airways 1509

Business

Boeing 787-9 Dreamliner

2h 00m•Change planes in London (LHR)

3:05 pm - 5:40 am(9h 05m)

Heathrow (LHR) - Chhatrapati Shivaji Intl (BOM)

British Airways 135

Business

Boeing 787-8 Dreamliner`;
  const r = convert(input);
  check("red-eye keeps its own date", r.itinerary.includes("BA 1509 17MAR LAX LHR 725P 105P¥1"), r.itinerary);
  check("connection rolls to 18MAR", r.itinerary.includes("BA 135 18MAR LHR BOM 305P 540A¥1"), r.itinerary);
}

{
  console.log("\n[Style C · dates] 26-hour layover dated from the printed connection time");
  const input = `Departing flight Wed, Mar 17

LAX → BOM

7:25 pm - 1:05 pm(10h 40m)

Los Angeles (LAX) - Heathrow (LHR)

British Airways 1509

Business

Boeing 787-9 Dreamliner

26h 00m•Change planes in London (LHR)

3:05 pm - 5:40 am(9h 05m)

Heathrow (LHR) - Chhatrapati Shivaji Intl (BOM)

British Airways 135

Business

Boeing 787-8 Dreamliner`;
  const r = convert(input);
  check("overnight stopover rolls two days", r.itinerary.includes("BA 135 19MAR LHR BOM 305P 540A¥1"), r.itinerary);
}

{
  console.log("\n[Style C · dates] a printed per-leg date is never overridden");
  // HND → YYZ crosses the date line and lands the same calendar day, so the
  // connection printed for Feb 27 must stay on Feb 27.
  const input = `Tokyo (HND) → Toronto (YYZ)
Thu, Feb 27
Air Canada 2
Boeing 777
Departure 6:50 PM · Arrival 4:55 PM
Premium Economy (A)
Duration: 12 hr 5 min

Toronto (YYZ) → Charlotte (CLT)
Thu, Feb 27
Air Canada 8749
Embraer 175
Departure 6:55 PM · Arrival 9:06 PM
Economy (G)
Duration: 2 hr 11 min`;
  const r = convert(input);
  check("printed 27FEB kept", r.itinerary.includes("AC 8749 27FEB YYZ CLT 655P 906P"), r.itinerary);
}

{
  console.log("\n[Style C · dates] enforceConnectionDates unit rules");
  const leg = (over: Partial<RawFlight>): RawFlight => ({
    airline: "BA",
    number: "1",
    origin: "AAA",
    dest: "BBB",
    date: { day: 17, month: 3 },
    dep: 600,
    arr: 900,
    arrDay: 0,
    order: 0,
    direction: "OUT",
    ...over,
  });

  const chain = [
    leg({ number: "1509", origin: "LAX", dest: "LHR", dep: 1165, arr: 785, arrDay: 1 }),
    leg({ number: "135", origin: "LHR", dest: "BOM", dep: 905, arr: 340, arrDay: 1, order: 1 }),
  ];
  const fixes = enforceConnectionDates(chain);
  check("impossible connection rolled forward", chain[1].date!.day === 18 && fixes.length === 1, JSON.stringify(chain[1].date));
  check("reports the leg it connects from", fixes[0]?.prev.number === "1509" && fixes[0]?.landsOn.day === 18, JSON.stringify(fixes[0]?.landsOn));

  const explicit = [
    leg({ number: "2", origin: "HND", dest: "YYZ", dep: 1130, arr: 1015, arrDay: 1 }),
    leg({ number: "8749", origin: "YYZ", dest: "CLT", dep: 1135, arr: 1266, order: 1, dateExplicit: true }),
  ];
  enforceConnectionDates(explicit);
  check("printed date left alone", explicit[1].date!.day === 17, JSON.stringify(explicit[1].date));

  const separate = [
    leg({ number: "1509", origin: "LAX", dest: "LHR", dep: 1165, arr: 785, arrDay: 1 }),
    leg({ number: "135", origin: "LHR", dest: "BOM", dep: 905, arr: 340, arrDay: 1, order: 1, direction: "IN" }),
  ];
  enforceConnectionDates(separate);
  check("never chains across outbound/return", separate[1].date!.day === 17, JSON.stringify(separate[1].date));

  const notConnected = [
    leg({ number: "1509", origin: "LAX", dest: "LHR", dep: 1165, arr: 785, arrDay: 1 }),
    leg({ number: "135", origin: "CDG", dest: "BOM", dep: 905, arr: 340, arrDay: 1, order: 1 }),
  ];
  enforceConnectionDates(notConnected);
  check("never chains when it is not a connection", notConnected[1].date!.day === 17, JSON.stringify(notConnected[1].date));

  const fine = [
    leg({ number: "134", origin: "BOM", dest: "LHR", dep: 570, arr: 900 }),
    leg({ number: "1609", origin: "LHR", dest: "LAX", dep: 1015, arr: 1210, order: 1 }),
  ];
  check("valid connection untouched", enforceConnectionDates(fine).length === 0 && fine[1].date!.day === 17);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
