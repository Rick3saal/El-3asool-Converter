/**
 * Self tests: runs the spec's canonical examples through the real pipeline.
 * Usage: npx tsx scripts/selftest.ts
 */
import { convertToSabre } from "../src/lib/converter";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, actual: string, expected: string) {
  if (actual === expected) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name}`);
    console.log("    --- expected ---");
    console.log(expected.split("\n").map((l) => "    |" + l).join("\n"));
    console.log("    --- actual ---");
    console.log(actual.split("\n").map((l) => "    |" + l).join("\n"));
  }
}

function checkTrue(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ✗ ${name} ${detail ?? ""}`);
  }
}

function convert(text: string, fallback?: "FIRST" | "BUSINESS" | "PREMIUM" | "ECONOMY" | null) {
  return convertToSabre(text, fallback ?? null);
}

/* ============ SPEC EXAMPLE 43 — BRITISH AIRWAYS 85 ============ */
{
  console.log("\n[Test 43] British Airways 85");
  const input = `London (LHR) → Newark (EWR)

Dec 31

10:40 AM → 1:50 PM

British Airways 85

Boeing 777

Business (I)`;
  const r = convert(input);
  check(
    "itinerary + additional",
    r.itinerary,
    `1 BA 085 31DEC LHR EWR 1040A 150P 777 8.10 0 N  CABIN-BUSINESS

<--additional-->
1 BA 085I 31DEC`
  );
  check("outbound", r.outbound, "0BA085I31DECLHREWRNN1");
  check("inbound", r.inbound, "");
  check("individual", r.individual, "0BA085I31DECLHREWRGK1");
}

/* ============ SPEC EXAMPLE 45 — AIR SERBIA / AMERICAN ============ */
{
  console.log("\n[Test 45] Air Serbia / American round trip");
  const input = `Round-trip, 1 traveler
Charlotte (CLT) → Budapest (BUD)

Wed, Dec 5
American Airlines 2509
Boeing 737
Charlotte (CLT) → Chicago (ORD)
Departure 2:54 PM · Arrival 4:10 PM
First (I)
Duration: 2 hr 16 min

Layover in Chicago (ORD)

Air Serbia 507
Chicago (ORD) → Belgrade (BEG)
Departure 5:30 PM · Arrival 10:20 AM +1
Business (W)
Duration: 9 hr 50 min
A330-200

Air Serbia 142
Belgrade (BEG) → Budapest (BUD)
Departure 1:30 PM · Arrival 2:40 PM
Economy (K)
Duration: 1 hr 10 min
Sat, Dec 6
ATR 72

Return

Sun, Dec 10
Air Serbia 143
Budapest (BUD) → Belgrade (BEG)
Departure 3:10 PM · Arrival 4:15 PM
Economy (K)
Duration: 1 hr 5 min
ATR 72

Mon, Dec 11
Air Serbia 506
Belgrade (BEG) → Chicago (ORD)
Departure 10:45 AM · Arrival 2:45 PM
Business (W)
Duration: 11 hr 0 min
A330-200

American Airlines 864
Chicago (ORD) → Charlotte (CLT)
Departure 4:45 PM · Arrival 7:57 PM
First (I)
Duration: 2 hr 12 min
Boeing 737`;
  const r = convert(input);
  check(
    "itinerary + additional",
    r.itinerary,
    `1 AA 2509 5DEC CLT ORD 254P 410P 73H 2.16 0 N  CABIN-FIRST
2 JU 507 5DEC ORD BEG 530P 1020A¥1 332 9.50 0 N  CABIN-BUSINESS
3 JU 142 6DEC BEG BUD 130P 240P ATR 1.10 0 N  CABIN-ECONOMY
4 JU 143 10DEC BUD BEG 310P 415P ATR 1.05 0 N  CABIN-ECONOMY
5 JU 506 11DEC BEG ORD 1045A 245P 332 11.00 0 N  CABIN-BUSINESS
6 AA 864 11DEC ORD CLT 445P 757P 73H 2.12 0 N  CABIN-FIRST

<--additional-->
1 AA 2509I 5DEC
2 JU 507W 5DEC
3 JU 142K 6DEC
4 JU 143K 10DEC
5 JU 506W 11DEC
6 AA 864I 11DEC`
  );
  check(
    "outbound",
    r.outbound,
    "0AA2509I5DECCLTORDNN1§0JU507W5DECORDBEGNN1§0JU142K6DECBEGBUDNN1"
  );
  check(
    "inbound",
    r.inbound,
    "0JU143K10DECBUDBEGNN1§0JU506W11DECBEGORDNN1§0AA864I11DECORDCLTNN1"
  );
  check(
    "individual",
    r.individual,
    `0AA2509I5DECCLTORDGK1
0JU507W5DECORDBEGGK1
0JU142K6DECBEGBUDGK1
0JU143K10DECBUDBEGGK1
0JU506W11DECBEGORDGK1
0AA864I11DECORDCLTGK1`
  );
}

/* ============ SPEC EXAMPLE 44 — AIR CANADA ============ */
{
  console.log("\n[Test 44] Air Canada");
  const input = `Charlotte (CLT) → Toronto (YYZ)
Tue, Feb 18
Air Canada 8746
Embraer 175
Departure 8:55 AM · Arrival 10:57 AM
Economy (G)
Duration: 2 hr 2 min
Operated by Air Canada Express - Jazz

Toronto (YYZ) → Tokyo (NRT)
Tue, Feb 18
Air Canada 9
Boeing 777
Departure 12:35 PM · Arrival 4:30 PM
Premium Economy (A)
Duration: 13 hr 55 min

Return

Tokyo (HND) → Toronto (YYZ)
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
Duration: 2 hr 11 min
Operated by Air Canada Express - Jazz`;
  const r = convert(input);
  check(
    "itinerary + additional",
    r.itinerary,
    `1 AC 8746 18FEB CLT YYZ 855A 1057A E75 2.02 0 N  CABIN-ECONOMY
*CLT-YYZ OPERATED BY AIR CANADA EXPRESS - JAZZ
2 AC 9 18FEB YYZ NRT 1235P 430P 777 13.55 0 N  CABIN-PREMIUM
3 AC 2 27FEB HND YYZ 650P 455P¥1 777 12.05 0 N  CABIN-PREMIUM
4 AC 8749 27FEB YYZ CLT 655P 906P E75 2.11 0 N  CABIN-ECONOMY
*YYZ-CLT OPERATED BY AIR CANADA EXPRESS - JAZZ

<--additional-->
1 AC 8746G 18FEB
2 AC 9A 18FEB
3 AC 2A 27FEB
4 AC 8749G 27FEB`
  );
  check(
    "outbound",
    r.outbound,
    "0AC8746G18FEBCLTYYZNN1§0AC9A18FEBYYZNRTNN1"
  );
  check(
    "inbound",
    r.inbound,
    "0AC2A27FEBHNDYYZNN1§0AC8749G27FEBYYZCLTNN1"
  );
  check(
    "individual",
    r.individual,
    `0AC8746G18FEBCLTYYZGK1
0AC9A18FEBYYZNRTGK1
0AC2A27FEBHNDYYZGK1
0AC8749G27FEBYYZCLTGK1`
  );
}

/* ============ TEST 8/11/16 — aircraft never a segment ============ */
{
  console.log("\n[Test 8] Aircraft must never create a segment");
  const input = `Egyptair 988
Boeing 787-9 Dreamliner
New York (JFK) → Cairo (CAI)
Wed, Nov 4
Departure 5:00 PM · Arrival 8:10 AM +1
Business`;
  const r = convert(input);
  checkTrue("exactly one segment", r.segments.length === 1, `got ${r.segments.length}`);
  checkTrue(
    "segment is MS 988 JFK->CAI, equip 789, class J, ¥1",
    r.itinerary.startsWith("1 MS 988 4NOV JFK CAI 500P 810A¥1 789 "),
    r.itinerary
  );
  checkTrue("no phantom BO/787 segment", !/BO 787/.test(r.itinerary));
  checkTrue("default business class J", r.outbound === "0MS988J4NOVJFKCAINN1", r.outbound);
}

/* ============ SPEC 19 — CANNN1 / CANGK1 ============ */
{
  console.log("\n[Test 19] CANNN1 and CANGK1 (CAN intact)");
  const input = `China Southern 328
Guangzhou (CAN) → Bangkok (BKK)
Sun, Jan 5
Departure 2:00 PM · Arrival 4:30 PM
Economy (G)
Duration: 2 hr 30 min`;
  const r = convert(input);
  checkTrue("NN1 has CANNN1", r.outbound.includes("0CZ328G5JANCANBKKNN1"), r.outbound);
  checkTrue("GK1 has CANGK1", r.individual.includes("0CZ328G5JANCANBKKGK1"), r.individual);
  checkTrue("never CANN1", !r.outbound.includes("CANN1") && !r.individual.includes("CANN1"));
  const input2 = input.replace("Guangzhou (CAN) → Bangkok (BKK)", "Bangkok (BKK) → Guangzhou (CAN)");
  const r2 = convert(input2);
  checkTrue("dest CAN stays intact in NN1", r2.outbound.includes("BKKCANNN1"), r2.outbound);
  checkTrue("dest CAN stays intact in GK1", r2.individual.includes("BKKCANGK1"), r2.individual);
}

/* ============ SPEC 26 — layover = separate segments ============ */
{
  console.log("\n[Test 26] Layover = two segments");
  const input = `American Airlines 100
New York (JFK) → Chicago (ORD)
Wed, Nov 4
Departure 8:00 AM · Arrival 9:05 AM
Economy (G)
Duration: 1 hr 5 min

Layover in Chicago (ORD) 1 hr 20 min

British Airways 200
Chicago (ORD) → London (LHR)
Wed, Nov 4
Departure 10:35 AM · Arrival 10:30 PM
Economy (K)
Duration: 7 hr 55 min`;
  const r = convert(input);
  checkTrue("two segments", r.segments.length === 2, `got ${r.segments.length}`);
  checkTrue(
    "seg1 AA 100 with own elapsed 1.05 (not layover 1 hr 20 min)",
    r.itinerary.includes("1 AA 100 4NOV JFK ORD 800A 905A ") && r.itinerary.includes("1.05 0 N"),
    r.itinerary
  );
  checkTrue(
    "seg2 BA 200 with elapsed 7.55",
    r.itinerary.includes("2 BA 200 4NOV ORD LHR 1035A 1030P ") && r.itinerary.includes("7.55 0 N"),
    r.itinerary
  );
}

/* ============ SPEC 27 — technical stop = one segment ============ */
{
  console.log("\n[Test 27] Technical stop, same flight number = one segment");
  const input = `Egyptair 988
New York (JFK) → Kolkata (CCU)
Stop in Kolkata (CCU)
Kolkata (CCU) → Delhi (DEL)
Wed, Nov 4
Departure 11:20 PM · Arrival 8:30 AM +1
Business
Boeing 787-9 Dreamliner`;
  const r = convert(input);
  checkTrue("one segment only", r.segments.length === 1, `got ${r.segments.length}`);
  checkTrue(
    "single segment JFK -> DEL",
    r.itinerary.includes("1 MS 988 4NOV JFK DEL 1120P 830A¥1 789"),
    r.itinerary
  );
}

/* ============ SPEC 20 — each flight owns its own date ============ */
{
  console.log("\n[Test 20] Dates stay with their own flights");
  const input = `Egyptair 988
EWR → CAI
Wed, Nov 4
Departure 6:00 PM · Arrival 8:30 AM +1
Business

Egyptair 987
CAI → EWR
Wed, Dec 30
Departure 2:00 PM · Arrival 7:30 PM
Business`;
  const r = convert(input);
  checkTrue("seg1 4NOV", r.itinerary.includes("1 MS 988 4NOV EWR CAI"), r.itinerary);
  checkTrue("seg2 30DEC", r.itinerary.includes("2 MS 987 30DEC CAI EWR"), r.itinerary);
  checkTrue("no date bleed", !r.itinerary.includes("MS 987 4NOV") && !r.itinerary.includes("MS 988 30DEC"));
  checkTrue("seg1 outbound NN1", r.outbound.includes("0MS988J4NOVEWRCAINN1"), r.outbound);
  checkTrue("seg2 inbound NN1", r.inbound.includes("0MS987J30DECCAIEWRNN1"), r.inbound);
}

/* ============ SPEC 28 — duplicate info merged ============ */
{
  console.log("\n[Test 28] Duplicate listings merge into one flight");
  const input = `New York → Cairo
Egyptair 988
EWR → CAI
Wed, Nov 4
Departure 6:00 PM · Arrival 8:30 AM +1
Business

Egyptair 988
EWR → CAI
Duration: 10 hr 30 min`;
  const r = convert(input);
  checkTrue("one segment", r.segments.length === 1, `got ${r.segments.length}`);
}

/* ============ SPEC 13/14/23/24/46 — classes ============ */
{
  console.log("\n[Test 13/14] Booking classes");
  const mk = (airline: string, num: string, cabin: string, date: string, dep: string, arr: string, extra = "") =>
    `${airline} ${num}
JFK → ORD
Wed, ${date}
Departure ${dep} · Arrival ${arr}
${cabin}${extra}
Duration: 2 hr 0 min`;
  const d = convert(mk("Egyptair", "986", "Business (D)", "Nov 4", "8:00 AM", "10:00 AM"));
  checkTrue("explicit D preserved", d.segments[0]?.bookingClass === "D", d.itinerary + "\n" + d.individual);
  const e = convert(mk("Egyptair", "985", "Economy", "Nov 4", "8:00 AM", "10:00 AM"));
  checkTrue("economy default Y", e.segments[0]?.bookingClass === "Y");
  const f = convert(mk("Egyptair", "984", "Premium Economy", "Nov 4", "8:00 AM", "10:00 AM"));
  checkTrue("premium default R + CABIN-PREMIUM", f.segments[0]?.bookingClass === "R" && f.itinerary.includes("CABIN-PREMIUM"));
  const g = convert(mk("Egyptair", "983", "First", "Nov 4", "8:00 AM", "10:00 AM"));
  checkTrue("first default I", g.segments[0]?.bookingClass === "I");
  const h = convert(mk("Egyptair", "982", "Business", "Nov 4", "8:00 AM", "10:00 AM"));
  checkTrue("business default J", h.segments[0]?.bookingClass === "J");
  checkTrue("no CABIN-PREMIUM ECONOMY", !f.itinerary.includes("CABIN-PREMIUM ECONOMY"));
}

/* ============ SPEC 35/47 — chains of 4 ============ */
{
  console.log("\n[Test 47] 4 outbound segments → 3+1 chain");
  const leg = (al: string, num: string, route: string, date: string, dep: string, arr: string, cls: string) =>
    `${al} ${num}
${route}
Wed, ${date}
Departure ${dep} · Arrival ${arr}
${cls}
Duration: 1 hr 30 min`;
  const input = [
    leg("American Airlines", "100", "JFK → ORD", "Dec 5", "8:00 AM", "9:30 AM", "First (I)"),
    leg("American Airlines", "200", "ORD → DFW", "Dec 5", "10:30 AM", "12:00 PM", "First (I)"),
    leg("American Airlines", "300", "DFW → LAX", "Dec 5", "1:00 PM", "2:30 PM", "First (I)"),
    leg("American Airlines", "400", "LAX → HNL", "Dec 5", "3:30 PM", "6:45 PM", "First (I)"),
    leg("American Airlines", "401", "HNL → LAX", "Dec 10", "7:00 AM", "2:30 PM", "First (I)"),
  ].join("\n\n");
  const r = convert(input);
  checkTrue("5 segments", r.segments.length === 5, `got ${r.segments.length}`);
  const outLines = r.outbound.split("\n");
  checkTrue(
    "first chain line has 3 entries each with NN1",
    outLines[0] === "0AA100I5DECJFKORDNN1§0AA200I5DECORDDFWNN1§0AA300I5DECDFWLAXNN1",
    r.outbound
  );
  checkTrue("fourth outbound on its own NN1 line", outLines[1] === "0AA400I5DECLAXHNLNN1", r.outbound);
  checkTrue("inbound single NN1", r.inbound === "0AA401I10DECHNLLAXNN1", r.inbound);
  checkTrue("individual still lists all with GK1", r.individual.split("\n").length === 5 && r.individual.split("\n").every((l) => l.endsWith("GK1")));
}

/* ============ SPEC 21 — no zero-padded times, A/P only ============ */
{
  console.log("\n[Test 21] time formatting");
  const r = convert(
    `Delta 100
JFK → LAX
Wed, Dec 5
Departure 5:00 AM · Arrival 8:10 AM
First (I)
Duration: 6 hr 10 min`
  );
  checkTrue("500A and 810A", r.itinerary.includes("500A 810A"), r.itinerary);
  checkTrue("no 05:00/AM text", !/05:00|AM/.test(r.itinerary));
}

/* ============ Spec 16 — BA 85 pad + 3-digit flight display ============ */
{
  console.log("\n[Test 16] BA 85 → BA 085");
  const r = convert(
    `British Airways 85
LHR → JFK
Wed, Dec 5
Departure 10:40 AM · Arrival 1:50 PM
Business (J)
Duration: 8 hr 10 min`
  );
  checkTrue("display BA 085 and sell 0BA085J", r.itinerary.includes("1 BA 085 ") && r.outbound.includes("0BA085J"), r.itinerary + "\n" + r.outbound);
}

/* ============ spec 44-style already-Sabre text (fast path) ============ */
{
  console.log("\n[Fast path] Sabre text re-parse");
  const sabreText = `1 AA 2509 5DEC CLT ORD 254P 410P 73H 2.16 0 N  CABIN-FIRST
2 JU 507 5DEC ORD BEG 530P 1020A¥1 332 9.50 0 N  CABIN-BUSINESS
3 JU 142 6DEC BEG BUD 130P 240P ATR 1.10 0 N  CABIN-ECONOMY
4 JU 143 10DEC BUD BEG 310P 415P ATR 1.05 0 N  CABIN-ECONOMY
5 JU 506 11DEC BEG ORD 1045A 245P 332 11.00 0 N  CABIN-BUSINESS
6 AA 864 11DEC ORD CLT 445P 757P 73H 2.12 0 N  CABIN-FIRST

<--additional-->
1 AA 2509I 5DEC
2 JU 507W 5DEC
3 JU 142K 6DEC
4 JU 143K 10DEC
5 JU 506W 11DEC
6 AA 864I 11DEC`;
  const r = convert(sabreText);
  checkTrue("6 segments parsed", r.segments.length === 6, `got ${r.segments.length}`);
  checkTrue("classes restored from additional", r.individual.includes("0JU142K6DECBEGBUDGK1") && r.individual.includes("0AA2509I5DECCLTORDGK1"), r.individual);
  checkTrue("direction grouping preserved", r.outbound.includes("§") && r.inbound.includes("§"));
}

/* ============ operated-by not duplicated anywhere but main ============ */
{
  console.log("\n[Operated-by] only under main itinerary segment");
  const r = convert(
    `United Airlines 1234
CLT → YYZ
Wed, Feb 18
Departure 8:55 AM · Arrival 10:57 AM
Economy (G)
Duration: 2 hr 2 min
Operated by Air Canada Express - Jazz`
  );
  checkTrue(
    "opby under main segment only",
    r.itinerary.includes("*CLT-YYZ OPERATED BY AIR CANADA EXPRESS - JAZZ") &&
      !r.outbound.includes("OPERATED") &&
      !r.inbound.includes("OPERATED") &&
      !r.individual.includes("OPERATED") &&
      !r.itinerary.slice(r.itinerary.indexOf("<--additional-->")).includes("OPERATED"),
    r.itinerary
  );
  const r2 = convert(
    `Air Canada 8746
CLT → YYZ
Wed, Feb 18
Departure 8:55 AM · Arrival 10:57 AM
Economy (G)
Duration: 2 hr 2 min
Operated by Air Canada`
  );
  // Operator is same as marketing carrier -> no operated-by line per requirement
  checkTrue(
    "operated-by omitted when same carrier (AC + Air Canada)",
    !r2.itinerary.includes("OPERATED BY"),
    r2.itinerary
  );
}

/* ============ duplicate times never leak between segments ============ */
{
  console.log("\n[Times] each segment keeps own times");
  const r = convert(
    `Air Serbia 507
ORD → BEG
Wed, Dec 5
Departure 5:30 PM · Arrival 10:20 AM +1
Business (W)
Duration: 9 hr 50 min

Air Serbia 142
BEG → BUD
Sat, Dec 6
Departure 1:30 PM · Arrival 2:40 PM
Economy (K)
Duration: 1 hr 10 min`
  );
  checkTrue(
    "seg1 530P/1020A¥1, seg2 130P/240P",
    r.itinerary.includes("1 JU 507 5DEC ORD BEG 530P 1020A¥1") && r.itinerary.includes("2 JU 142 6DEC BEG BUD 130P 240P"),
    r.itinerary
  );
}

/* ============ ONE-WAY ============ */
{
  console.log("\n[One-way] all outbound");
  const r = convert(
    `Qatar Airways 701
DOH → JFK
Wed, Dec 5
Departure 8:00 AM · Arrival 1:30 PM
Business (J)
Duration: 13 hr 30 min`
  );
  checkTrue("single outbound, no inbound", r.outbound === "0QR701J5DECDOHJFKNN1" && r.inbound === "", r.outbound + " || " + r.inbound);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (failures.length) {
  console.log("Failures:", failures.join(" | "));
  process.exit(1);
}
