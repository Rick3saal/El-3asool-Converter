import { convertToSabre } from "../src/lib/converter";
let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
const convert = (t: string) => convertToSabre(t, null);

// 1. Google-Flights style messy copy with noise
{
  const r = convert(`Round-trip, 1 traveler
New York → Cairo
Egyptair
Wed, Nov 4
Egyptair 988 · Boeing 787-9 Dreamliner
10:40 PM JFK → 11:20 AM +1 CAI
Business (J)
Nonstop · 10 hr 40 min
$1,842

Return
Wed, Dec 30
2:00 PM CAI → 7:30 PM JFK
Egyptair 987
Airbus A330-300
Economy (K)
12 hr 30 min
Price includes taxes`);
  check("noise text parses 2 segments", r.segments.length === 2, JSON.stringify(r.segments.map(s => `${s.airline}${s.num} ${s.origin}-${s.dest}`)));
  const ms988 = r.segments.find(s => s.num === "988");
  check("MS 988 JFK->CAI 4NOV 1040P->1120A¥1 789", !!ms988 && r.itinerary.includes("1 MS 988 4NOV JFK CAI 1040P 1120A¥1 789"), r.itinerary);
  check("MS 987 30DEC CAI->JFK 333", r.itinerary.includes("2 MS 987 30DEC CAI JFK 200P 730P 333"), r.itinerary);
  check("no phantom from Boeing/Airbus", !/BO |A3 /.test(r.itinerary));
  check("outbound only MS988", r.outbound.includes("0MS988J4NOVJFKCAINN1") && !r.outbound.includes("987"), r.outbound);
}

// 2. single-line row style (Kayak/Google compact)
{
  const r = convert(`Wed, Nov 4
10:40 AM British Airways 85 London (LHR) → Newark (EWR) 1:50 PM
Boeing 777 · Business (I) · 8 hr 10 min`);
  check("single-line row", r.segments.length === 1 && r.itinerary.includes("1 BA 085 4NOV LHR EWR 1040A 150P 777 8.10"), r.itinerary);
}

// 3. spec 12 noise only — zero flights
{
  const r = convert(`Round-trip, 1 Traveler
Nonstop
Overnight flight
Wide-body jet
https://example.com/img/logo.png
![alt](https://x.com/i.png)`);
  check("noise only → no output", !r.hasOutput && r.segments.length === 0);
}

// 4. junk text does not crash and finds nothing
{
  const r = convert("hello world this is not an itinerary 12345");
  check("junk text safe", r.segments.length === 0);
}

// 5. operated-by after codeshare text must not create segment
{
  const r = convert(`United 1234
United Airlines 1234
EWR → ORD
Wed, Nov 4
Departure 8:00 AM · Arrival 9:30 AM
Economy (G)
Duration: 1 hr 30 min
Operated by Air Canada Express as flight AC 8746`);
  check("operator's flight number inside operated-by does not become a segment", r.segments.length === 1, JSON.stringify(r.segments.map(s=>s.airline+s.num)));
  check("marketing carrier stays UA", r.segments[0]?.airline === "UA" && r.segments[0]?.num === "1234");
}

// 6. round trip reusing same flight number both ways must not merge
{
  const r = convert(`Egyptair 988
JFK → CAI
Wed, Nov 4
Departure 11:00 PM · Arrival 1:30 PM +1
Business

Egyptair 988
CAI → JFK
Wed, Dec 30
Departure 9:00 AM · Arrival 12:30 PM
Business`);
  check("same flight number round trip = 2 segments", r.segments.length === 2, `got ${r.segments.length}`);
  check("seg1 JFK->CAI 4NOV, seg2 CAI->JFK 30DEC", r.itinerary.includes("1 MS 988 4NOV JFK CAI") && r.itinerary.includes("2 MS 988 30DEC CAI JFK"), r.itinerary);
  check("directions out/in split", r.outbound.includes("JFKCAINN1") && r.inbound.includes("CAIJFKNN1"), r.outbound + "|" + r.inbound);
}



/* ============ USER MANDATE — 4 real flights = 4 segments ============ */
{
  console.log("\n[Atomicity] UA 5810 / UA 929 / UA 958 / UA 4577 → exactly 4 segments");
  const input = `United Airlines 5810
Newark (EWR) → Chicago (ORD)
Wed, Jan 8
Departure 8:15 PM · Arrival 9:45 PM
Economy (G)
Duration: 1 hr 30 min

United Airlines 929
Chicago (ORD) → Frankfurt (FRA)
Wed, Jan 8
Departure 11:15 PM · Arrival 1:20 PM +1
Business (J)
Duration: 8 hr 5 min
Boeing 767-300

Layover in Chicago (ORD) (3 hr 23 min)

United Airlines 958
Frankfurt (FRA) → Dubai (DXB)
Thu, Jan 9
Departure 4:05 PM · Arrival 11:55 PM
Economy (G)
Duration: 5 hr 50 min
Operated by Lufthansa

United Airlines 4577
Dubai (DXB) → Newark (EWR)
Fri, Jan 10
Departure 2:10 AM · Arrival 8:00 AM
Economy (Y)
Duration: 12 hr 50 min`;
  const r = convert(input);
  check("exactly 4 segments", r.segments.length === 4, `got ${r.segments.length}: ` + r.segments.map(s => s.airline + s.num).join(","));
  check("all four flight numbers present", ["5810", "929", "958", "4577"].every(n => r.segments.some(s => s.num === n)), r.segments.map(s => s.num).join(","));
  check("layover duration never used as flight elapsed", !r.itinerary.includes("3.23") && !r.itinerary.includes("3.38"), r.itinerary);
  check("UA5810 keeps own date/time/elapsed", r.itinerary.includes("1 UA 5810 8JAN EWR ORD 815P 945P --- 1.30 0 N  CABIN-ECONOMY"), r.itinerary);
  check("UA929 keeps own ¥1 + 763 + 8.05", r.itinerary.includes("2 UA 929 8JAN ORD FRA 1115P 120P¥1 763 8.05 0 N  CABIN-BUSINESS"), r.itinerary);
  check("UA958 keeps own 5.50 + own date", r.itinerary.includes("3 UA 958 9JAN FRA DXB 405P 1155P --- 5.50 0 N  CABIN-ECONOMY"), r.itinerary);
  check("UA4577 keeps own 12.50 + own date", r.itinerary.includes("4 UA 4577 10JAN DXB EWR 210A 800A --- 12.50 0 N  CABIN-ECONOMY"), r.itinerary);
  check("marketing carrier UA kept, operated-by attached", r.segments[2]?.airline === "UA" && r.segments[2]?.num === "958" && r.segments[2]?.operatedBy === "LUFTHANSA", JSON.stringify(r.segments[2]?.operatedBy));
  check("opby line only under segment 3 in main itinerary", r.itinerary.includes("*FRA-DXB OPERATED BY LUFTHANSA") && r.itinerary.indexOf("OPERATED") === r.itinerary.lastIndexOf("OPERATED"), r.itinerary);
  check("direction split 3 out / 1 in", r.segments.filter(s => s.direction === "OUT").length === 3 && r.segments.filter(s => s.direction === "IN").length === 1);
  check("continuous numbering 1-4", /^1 UA /m.test(r.itinerary) && /^4 UA /m.test(r.itinerary) && !/^5 /m.test(r.itinerary));
  check("no 3.23 anywhere in any output", ![r.itinerary, r.outbound, r.inbound, r.individual].join("\n").includes("3.23"));
}

/* ============ USER MANDATE — row style, flight after layover line ============ */
{
  console.log("\n[Atomicity] row-format flights (no flight skipped after a layover line)");
  const input = `Wed, Jan 8 UA 5810 JFK ORD 254P 410P
Wed, Jan 8 UA 929 ORD FRA 530P 830A +1
Layover in Chicago (ORD) (1 hr 5 min)
Thu, Jan 9 UA 958 FRA DXB 905A 550P
Fri, Jan 10 UA 4577 DXB JFK 210A 830A`;
  const r = convertToSabre(input, "ECONOMY");
  check("exactly 4 segments", r.segments.length === 4, `got ${r.segments.length}`);
  check("no flight vanished after layover row", r.segments.map(s => s.num).join(",") === "5810,929,958,4577", r.segments.map(s => s.num).join(","));
  check("seg1 JFK ORD 254P 410P", r.itinerary.includes("1 UA 5810 8JAN JFK ORD 254P 410P"), r.itinerary);
  check("seg2 ORD FRA 530P 830A¥1", /2 UA 929 8JAN ORD FRA 530P 830A¥1/.test(r.itinerary), r.itinerary);
  check("seg3 FRA DXB 905A 550P", r.itinerary.includes("3 UA 958 9JAN FRA DXB 905A 550P"), r.itinerary);
  check("seg4 DXB JFK 210A 830A", r.itinerary.includes("4 UA 4577 10JAN DXB JFK 210A 830A"), r.itinerary);
  check("layover 1 hr 5 min did not become elapsed", !r.itinerary.includes("1.05 0 N"), r.itinerary);
  check("each row keeps its own date", r.itinerary.includes("8JAN") && r.itinerary.includes("9JAN") && r.itinerary.includes("10JAN"), r.itinerary);
}

/* ============ USER MANDATE — block fields never bleed across flights ============ */
{
  console.log("\n[Atomicity] cabin/class/date/times of one flight never complete a neighbor");
  const input = `Egyptair 988
JFK → CAI
Wed, Nov 4
Departure 10:40 PM · Arrival 11:20 AM +1
Business (D)
Duration: 10 hr 40 min

Egyptair 987
CAI → JFK
Wed, Dec 30
Departure 2:00 PM · Arrival 7:30 PM
Economy
Duration: 12 hr 30 min`;
  const r = convert(input);
  check("flight 2 not completed with flight 1's date/times/class", r.segments.length === 2, `got ${r.segments.length}`);
  const s2 = r.segments[1];
  check("seg2 date 30DEC", s2?.date.day === 30 && s2?.date.month === 12);
  check("seg2 dep 200P arr 730P", s2?.dep === 840 && s2?.arr === 1170);
  check("seg2 economy default Y (not D from flight 1)", s2?.bookingClass === "Y", `got ${s2?.bookingClass}`);
  check("seg2 CABIN-ECONOMY", r.itinerary.includes("2 MS 987 30DEC CAI JFK 200P 730P --- 12.30 0 N  CABIN-ECONOMY"), r.itinerary);
}

/* ====== REGRESSION: header-above-flight layout (ICT/LHR, United) ====== */
{
  console.log("\n[Regression] AgentSearch-style ICT↔LHR with headers above each flight");
  const input = `Wichita (ICT) to London (LHR) on Tue, Sep 22 Warning IconWarning IconWarning IconWarning Icon

Wichita (ICT) to Chicago (ORD) on Tue, Sep 22
10:55 AM to 1:02 PM (2h 7m)
United 5810 (operated by Skywest Dba United Express)
Bombardier Regional Jet 550
Economy (B) 
Layover in ORD (3h 23m)

Chicago (ORD) to London (LHR) on Tue, Sep 22
4:25 PM to 6:45 AM (8h 20m)
United 929
Boeing 767
Premium Economy (R) 
London (LHR) to Wichita (ICT) on Tue, Oct 6 Warning IconWarning Icon

London (LHR) to Chicago (ORD) on Tue, Oct 6
8:00 AM to 11:10 AM (9h 10m)
United 958
Boeing 767
Premium Economy (R) 
Layover in ORD (1h 35m)

Chicago (ORD) to Wichita (ICT) on Tue, Oct 6
12:45 PM to 2:52 PM (2h 7m)
United 4577 (operated by Gojet Airlines Dba United Express)
Bombardier Regional Jet 550
Economy (B) `;
  const r = convert(input);
  check("exactly 4 segments (none skipped)", r.segments.length === 4, `got ${r.segments.length}`);
  check("no issues at all", r.issues.length === 0, JSON.stringify(r.issues));
  check(
    "full itinerary matches expected",
    r.itinerary ===
      `1 UA 5810 22SEP ICT ORD 1055A 102P 550 2.07 0 N  CABIN-ECONOMY
*ICT-ORD OPERATED BY SKYWEST DBA UNITED EXPRESS
2 UA 929 22SEP ORD LHR 425P 645A¥1 767 8.20 0 N  CABIN-PREMIUM
3 UA 958 6OCT LHR ORD 800A 1110A 767 9.10 0 N  CABIN-PREMIUM
4 UA 4577 6OCT ORD ICT 1245P 252P 550 2.07 0 N  CABIN-ECONOMY
*ORD-ICT OPERATED BY GOJET AIRLINES DBA UNITED EXPRESS

<--additional-->
1 UA 5810B 22SEP
2 UA 929R 22SEP
3 UA 958R 6OCT
4 UA 4577B 6OCT`,
    r.itinerary
  );
  check("outbound", r.outbound === "0UA5810B22SEPICTORDNN1§0UA929R22SEPORDLHRNN1", r.outbound);
  check("inbound", r.inbound === "0UA958R6OCTLHRORDNN1§0UA4577B6OCTORDICTNN1", r.inbound);
  check(
    "individual",
    r.individual ===
      `0UA5810B22SEPICTORDGK1
0UA929R22SEPORDLHRGK1
0UA958R6OCTLHRORDGK1
0UA4577B6OCTORDICTGK1`,
    r.individual
  );
  check("trip header ICT→LHR never became a leg", !r.itinerary.includes("ICT LHR"), r.itinerary);
  check("return header LHR→ICT never became a leg", !r.itinerary.includes("LHR ICT"), r.itinerary);
  check("layover 3h23m / 1h35m never used as elapsed", !r.itinerary.includes("3.23") && !r.itinerary.includes("1.35"), r.itinerary);
  check("operator trading names kept in full", r.itinerary.includes("SKYWEST DBA UNITED EXPRESS") && r.itinerary.includes("GOJET AIRLINES DBA UNITED EXPRESS"));
  check("11:10 AM parsed as 1110A (not 1000A)", r.itinerary.includes("800A 1110A"), r.itinerary);
}

/* ====== REGRESSION: arrival-date marker must not steal the departure date ====== */
{
  console.log("\n[Regression] Cathay JFK-HKG-NRT with arrival date 'on Tue, Mar 16'");
  const input = `New York (JFK) to Tokyo (NRT) on Mon, Mar 15

New York (JFK) to Hong Kong (HKG) on Mon, Mar 15
10:00 AM to 2:05 PM on Tue, Mar 16 (16h 5m)
Cathay Pacific 841
Airbus A350
Business (P)
Layover in HKG (1h 20m)

Hong Kong (HKG) to Tokyo (NRT) on Tue, Mar 16
3:25 PM to 8:20 PM (3h 55m)
Cathay Pacific 500
Airbus A330
Business (P)
Tokyo (NRT) to New York (JFK) on Wed, Mar 31 Warning IconWarning Icon

Tokyo (NRT) to Hong Kong (HKG) on Wed, Mar 31
6:30 PM to 10:20 PM (4h 50m)
Cathay Pacific 505
Boeing 777
Business (P)
Layover in HKG (4h 5m)

Hong Kong (HKG) to New York (JFK) on Thu, Apr 1
2:25 AM to 6:00 AM on Thu, Apr 1 (15h 35m)
Cathay Pacific 844
Airbus A350
Business (P)`;
  const r = convert(input);
  check("4 segments", r.segments.length === 4, `got ${r.segments.length}`);
  check("no issues", r.issues.length === 0, JSON.stringify(r.issues));
  check(
    "CX 841 departs 15MAR (header date), not the 16MAR arrival marker",
    r.itinerary.includes("1 CX 841 15MAR JFK HKG 1000A 205P¥1 350 16.05"),
    r.itinerary
  );
  check("CX 500 16MAR with A330 -> 330", r.itinerary.includes("2 CX 500 16MAR HKG NRT 325P 820P 330 3.55"), r.itinerary);
  check("CX 505 31MAR", r.itinerary.includes("3 CX 505 31MAR NRT HKG 630P 1020P 777 4.50"), r.itinerary);
  check("CX 844 1APR same-day, no offset", r.itinerary.includes("4 CX 844 1APR HKG JFK 225A 600A 350 15.35"), r.itinerary);
  check(
    "outbound chain",
    r.outbound === "0CX841P15MARJFKHKGNN1§0CX500P16MARHKGNRTNN1",
    r.outbound
  );
  check(
    "inbound chain",
    r.inbound === "0CX505P31MARNRTHKGNN1§0CX844P1APRHKGJFKNN1",
    r.inbound
  );
  check(
    "individual",
    r.individual ===
      `0CX841P15MARJFKHKGGK1
0CX500P16MARHKGNRTGK1
0CX505P31MARNRTHKGGK1
0CX844P1APRHKGJFKGK1`,
    r.individual
  );
}

/* ====== SELF-LEARNING ====== */
{
  console.log("\n[Learning] corrections are remembered and re-applied");
  const { learnFlight, learnAircraft, applyLearned, lookupLearnedAircraft, clearLearned } = await import(
    "../src/lib/learning"
  );
  clearLearned();
  const input = `Chicago (ORD) to London (LHR) on Fri, Dec 5
4:25 PM to 6:45 AM (8h 20m)
United 929
Boeing 767
Premium Economy (R)`;
  const r1 = convert(input);
  check("baseline has 1 segment", r1.segments.length === 1, `got ${r1.segments.length}`);
  // user edits: equipment -> 763 (pretend correction) and operator
  const edited = { ...r1.segments[0], equip: "763", operatedBy: "UNITED AIRLINES INC" };
  learnFlight(edited);
  learnAircraft("boeing 767", "763");
  const r2 = convert(input);
  check("learned equipment applied", r2.segments[0].equip === "763", r2.segments[0].equip);
  check("learned operator applied", r2.segments[0].operatedBy === "UNITED AIRLINES INC", r2.segments[0].operatedBy ?? "—");
  check("learned aircraft phrase lookup", lookupLearnedAircraft("Boeing 767") === "763", String(lookupLearnedAircraft("Boeing 767")));
  const direct = applyLearned([{ ...r1.segments[0] }]);
  check("applyLearned maps fields", direct[0].equip === "763" && direct[0].operatedBy === "UNITED AIRLINES INC", JSON.stringify(direct[0]));
  clearLearned();
  const r3 = convert(input);
  check("after clearLearned, baseline restored", r3.segments[0].equip === "767", r3.segments[0].equip);
}

/* ====== REGRESSION: independent one-way journeys split outbound/inbound ====== */
{
  console.log("\n[Regression] MIA-LIS outbound + separate LHR-YYZ return");
  const input = `Miami (MIA) to Lisbon (LIS) on Wed, Nov 4 Warning IconWarning Icon

Miami (MIA) to Madrid (MAD) on Wed, Nov 4
3:30 PM to 5:50 AM on Thu, Nov 5 (8h 20m)
Iberia 4610 (operated by American)
Boeing 777
Business (I)
Layover in MAD (1h 25m)

Madrid (MAD) to Lisbon (LIS) on Thu, Nov 5
7:15 AM to 7:40 AM (1h 25m)
Iberia 529
Airbus A320
Business (I)
London (LHR) to Toronto (YYZ) on Fri, Feb 19

London (LHR) to Toronto (YYZ) on Fri, Feb 19
5:15 PM to 8:15 PM on Fri, Feb 19 (8h 0m)
Finnair 5999 (operated by British Airways)
Airbus A350
Economy (O)`;
  const r = convert(input);
  check("3 segments total", r.segments.length === 3, `got ${r.segments.length}`);
  check("2 outbound / 1 inbound", r.segments.filter((s) => s.direction === "OUT").length === 2 && r.segments.filter((s) => s.direction === "IN").length === 1, r.outbound + " | " + r.inbound);
  check("no issues", r.issues.length === 0, JSON.stringify(r.issues));
  check(
    "outbound chain = 2 connecting legs",
    r.outbound === "0IB4610I4NOVMIAMADNN1§0IB529I5NOVMADLISNN1",
    r.outbound
  );
  check("return = the single LHR-YYZ leg", r.inbound === "0AY5999O19FEBLHRYYZNN1", r.inbound);
  check(
    "individual lists all 3 with GK1",
    r.individual ===
      `0IB4610I4NOVMIAMADGK1
0IB529I5NOVMADLISGK1
0AY5999O19FEBLHRYYZGK1`,
    r.individual
  );
  check("operated-by under each main segment only", r.itinerary.includes("*MIA-MAD OPERATED BY AMERICAN") && r.itinerary.includes("*LHR-YYZ OPERATED BY BRITISH AIRWAYS"), r.itinerary);
}

/* ====== REGRESSION: SAN->OKA round trip (aircraft phantom, Jetstar/JAL, airport change) ====== */
{
  console.log("\n[Regression] SAN-OKA multi-airline round trip");
  const input = `San Diego (SAN) to Okinawa (OKA) on Mon, Mar 29 Warning IconWarning IconWarning Icon

San Diego (SAN) to Vancouver (YVR) on Mon, Mar 29
7:05 AM to 10:22 AM (3h 17m)
Air Canada 8763 (operated by Air Canada Express - Jazz)
Canadair RJ 900
Business (P)
Layover in YVR (2h 38m)

Vancouver (YVR) to Tokyo (NRT) on Mon, Mar 29
1:00 PM to 2:55 PM on Tue, Mar 30 (9h 55m)
Air Canada 3
Boeing 787
Business (P)
Layover in NRT (4h 10m)

Tokyo (NRT) to Okinawa (OKA) on Tue, Mar 30
7:05 PM to 10:10 PM (3h 5m)
Jetstar 339
Airbus A320
Economy (B)
Okinawa (OKA) to San Diego (SAN) on Thu, Apr 15 Warning IconWarning IconWarning Icon

Okinawa (OKA) to Osaka (ITM) on Thu, Apr 15
12:05 PM to 1:55 PM (1h 50m)
JAL 2084
Airbus A350
Business (X)
Change of airport (4h 5m)

Osaka (KIX) to Vancouver (YVR) on Thu, Apr 15
6:00 PM to 11:15 AM (9h 15m)
Air Canada 24
Boeing 787
Business (P)
Layover in YVR (3h 45m)

Vancouver (YVR) to San Diego (SAN) on Thu, Apr 15
3:00 PM to 6:00 PM (3h 0m)
Air Canada 8766 (operated by Air Canada Express - Jazz)
Canadair RJ 900
Business (P)`;
  const r = convert(input);
  check("6 segments (none skipped)", r.segments.length === 6, `got ${r.segments.length}`);
  check("no issues at all", r.issues.length === 0, JSON.stringify(r.issues));
  check("3 outbound / 3 inbound", r.segments.filter((s) => s.direction === "OUT").length === 3 && r.segments.filter((s) => s.direction === "IN").length === 3, JSON.stringify(r.segments.map((s) => s.direction)));
  check("no phantom 'RJ 900' segment", !/\bRJ 900\b/.test(r.itinerary), r.itinerary);
  check(
    "full itinerary matches expected",
    r.itinerary ===
      `1 AC 8763 29MAR SAN YVR 705A 1022A 900 3.17 0 N  CABIN-BUSINESS
*SAN-YVR OPERATED BY AIR CANADA EXPRESS - JAZZ
2 AC 3 29MAR YVR NRT 100P 255P¥1 787 9.55 0 N  CABIN-BUSINESS
3 GK 339 30MAR NRT OKA 705P 1010P 320 3.05 0 N  CABIN-ECONOMY
4 JL 2084 15APR OKA ITM 1205P 155P 350 1.50 0 N  CABIN-BUSINESS
5 AC 24 15APR KIX YVR 600P 1115A¥1 787 9.15 0 N  CABIN-BUSINESS
6 AC 8766 15APR YVR SAN 300P 600P 900 3.00 0 N  CABIN-BUSINESS
*YVR-SAN OPERATED BY AIR CANADA EXPRESS - JAZZ

<--additional-->
1 AC 8763P 29MAR
2 AC 3P 29MAR
3 GK 339B 30MAR
4 JL 2084X 15APR
5 AC 24P 15APR
6 AC 8766P 15APR`,
    r.itinerary
  );
  check("outbound 3-chain", r.outbound === "0AC8763P29MARSANYVRNN1§0AC3P29MARYVRNRTNN1§0GK339B30MARNRTOKANN1", r.outbound);
  check("inbound 3-chain", r.inbound === "0JL2084X15APROKAITMNN1§0AC24P15APRKIXYVRNN1§0AC8766P15APRYVRSANNN1", r.inbound);
  check("Jetstar -> GK 339", r.itinerary.includes("3 GK 339 30MAR NRT OKA"));
  check("JAL -> JL 2084", r.itinerary.includes("4 JL 2084 15APR OKA ITM"));
  check("airport change ITM then KIX kept", r.itinerary.includes("5 AC 24 15APR KIX YVR"));
  check("AC 24 not padded to 024", r.itinerary.includes("AC 24 ") && !r.itinerary.includes("AC 024"));
  check("Canadair RJ 900 -> equip 900", r.itinerary.includes("900 3.17") && r.itinerary.includes("900 3.00"));
}

/* ====== REGRESSION: LX Swiss "to9:20 AM+1" glued layout ====== */
{
  console.log("\n[Regression] LX JFK-GVA-LHR glued 'to' times + Operated by Swiss");
  const input = `New York (JFK) to London (LHR) on Mon, Nov 9

LX
New York (JFK) to Geneva (GVA)

Mon, Nov 9

LX 23 (Operated by Swiss)

7:35 PM
to9:20 AM+1
(7h 45m)

Airbus A330-300 | Business Class (P)

3h 30m Layover

Geneva, Switzerland. This is a connecting flight in GVA.

LX
Geneva (GVA) to London (LHR)

Tue, Nov 10

LX 354 (Operated by Swiss)

12:50 PM
to1:40 PM
(1h 50m)

Airbus A220-300 | Business Class (P)`;
  const r = convert(input);
  check("2 segments", r.segments.length === 2, `got ${r.segments.length}`);
  check("no error issues", r.issues.filter((i) => i.level === "error").length === 0, JSON.stringify(r.issues));
  check(
    "full itinerary matches expected",
    r.itinerary ===
      `1 LX 23 9NOV JFK GVA 735P 920A¥1 333 7.45 0 N  CABIN-BUSINESS
2 LX 354 10NOV GVA LHR 1250P 140P 223 1.50 0 N  CABIN-BUSINESS

<--additional-->
1 LX 23P 9NOV
2 LX 354P 10NOV`,
    r.itinerary
  );
  check("glued 'to9:20' arrival parsed with +1", r.itinerary.includes("735P 920A¥1"), r.itinerary);
  check("A330-300 -> 333", r.itinerary.includes("333 7.45"));
  check("A220-300 -> 223", r.itinerary.includes("223 1.50"));
  check("operated-by omitted when same carrier (LX + Swiss)", !r.itinerary.includes("OPERATED BY"));
  check("outbound chain", r.outbound === "0LX23P9NOVJFKGVANN1§0LX354P10NOVGVALHRNN1", r.outbound);
  check("no inbound (one-way)", r.inbound === "", r.inbound);
}

/* ====== AI JSON -> RawFlight mapping ====== */
{
  console.log("\n[AI] structured JSON maps into the same converter");
  const { toRawFlights } = await import("../src/lib/ai");
  const { convertFlights } = await import("../src/lib/converter");
  const flights = toRawFlights({
    flights: [
      { airline: "LX", flightNumber: 23, origin: "JFK", destination: "GVA", date: { day: 9, month: 11 }, departure: "19:35", arrival: "09:20", arrivalDayOffset: 1, aircraft: "Airbus A330-300", cabin: "BUSINESS", bookingClass: "P", operatedBy: "Swiss" },
      { airline: "LX", flightNumber: "354", origin: "GVA", destination: "LHR", date: "10NOV", departure: "12:50", arrival: "13:40", aircraft: "Airbus A220-300", cabin: "BUSINESS", bookingClass: "P", operatedBy: "Swiss" },
    ],
  });
  check("2 flights mapped", flights.length === 2, `got ${flights.length}`);
  check("departure 19:35 -> 735P", flights[0].dep === 19 * 60 + 35, String(flights[0].dep));
  check("+1 offset captured", flights[0].arrDay === 1);
  check("date '10NOV' parsed", flights[1].date?.day === 10 && flights[1].date?.month === 11);
  const r = convertFlights(flights, null);
  check(
    "AI flights produce identical Sabre output",
    r.itinerary ===
      `1 LX 23 9NOV JFK GVA 735P 920A¥1 333 7.45 0 N  CABIN-BUSINESS
2 LX 354 10NOV GVA LHR 1250P 140P 223 1.50 0 N  CABIN-BUSINESS

<--additional-->
1 LX 23P 9NOV
2 LX 354P 10NOV`,
    r.itinerary
  );
}

/* ====== AI SELF-LEARNING & PERSISTENT RETENTION ====== */
{
  console.log("\n[AI Learning] system learns from AI and auto-converts without AI next time");
  const {
    learnItinerary,
    findLearnedItinerary,
    lookupFlightKnowledge,
    clearLearned,
  } = await import("../src/lib/learning");
  const { toRawFlights } = await import("../src/lib/ai");

  clearLearned();

  const novelText = `SPECIAL ITINERARY CONFIRMATION
FLT 1: Swiss International Air Lines 8820
DEPART: Zurich (ZRH)
ARRIVE: Singapore (SIN)
TRAVEL DATE: 18MAY
CABIN: First Class (F)
EQUIPMENT: Boeing 777-300ER
DEP: 22:40 ARR: 17:15 (+1)
OPERATED BY: SWISS

FLT 2: Singapore Airlines 215
DEPART: Singapore (SIN)
ARRIVE: Perth (PER)
TRAVEL DATE: 19MAY
CABIN: Business Class (J)
EQUIPMENT: Airbus A350-900
DEP: 18:45 ARR: 23:55
OPERATED BY: SINGAPORE AIRLINES`;

  // 1. Simulate AI extraction
  const aiExtracted = toRawFlights({
    flights: [
      {
        airline: "LX",
        flightNumber: 8820,
        origin: "ZRH",
        destination: "SIN",
        date: { day: 18, month: 5 },
        departure: "22:40",
        arrival: "17:15",
        arrivalDayOffset: 1,
        aircraft: "Boeing 777-300ER",
        cabin: "FIRST",
        bookingClass: "F",
        operatedBy: "SWISS",
      },
      {
        airline: "SQ",
        flightNumber: 215,
        origin: "SIN",
        destination: "PER",
        date: { day: 19, month: 5 },
        departure: "18:45",
        arrival: "23:55",
        arrivalDayOffset: 0,
        aircraft: "Airbus A350-900",
        cabin: "BUSINESS",
        bookingClass: "J",
        operatedBy: "SINGAPORE AIRLINES",
      },
    ],
  });

  // 2. System learns it
  const entry = learnItinerary(novelText, aiExtracted);
  check("itinerary learned and summary built", Boolean(entry?.summary.includes("LX 8820") && entry?.summary.includes("SQ 215")));

  // 3. Convert without AI (AI off / closed)
  const convertedDirect = convert(novelText);
  check("converted 2 segments without AI", convertedDirect.segments.length === 2, `got ${convertedDirect.segments.length}`);
  check(
    "recognised from AI-learned memory info note",
    convertedDirect.issues.some((i) => i.text.includes("Recognized from AI-learned memory")),
    JSON.stringify(convertedDirect.issues)
  );
  check(
    "exact Sabre itinerary produced from learned memory",
    convertedDirect.itinerary.includes("1 LX 8820 18MAY ZRH SIN 1040P 515P¥1 77W 11.35 0 N  CABIN-FIRST") &&
      convertedDirect.itinerary.includes("2 SQ 215 19MAY SIN PER 645P 1155P 359 5.10 0 N  CABIN-BUSINESS"),
    convertedDirect.itinerary
  );
  check("outbound chained", convertedDirect.outbound === "0LX8820F18MAYZRHSINNN1§0SQ215J19MAYSINPERNN1", convertedDirect.outbound);
  check(
    "individual GK1",
    convertedDirect.individual.includes("0LX8820F18MAYZRHSINGK1") && convertedDirect.individual.includes("0SQ215J19MAYSINPERGK1"),
    convertedDirect.individual
  );

  // 4. Flight knowledge base verification
  const k = lookupFlightKnowledge("LX", "8820");
  check("flight knowledge saved for LX 8820", k?.origin === "ZRH" && k?.dest === "SIN" && k?.equip === "77W");

  // 5. Date-adapted matching on a new date
  const textNewDate = novelText.replace(/18MAY/g, "24NOV").replace(/19MAY/g, "25NOV");
  const matchAdapted = findLearnedItinerary(textNewDate);
  check("date-adapted match succeeds without AI", !!matchAdapted && matchAdapted.isAdaptedDates);
  const convertedNewDate = convert(textNewDate);
  check(
    "Sabre itinerary adapts new date 24NOV / 25NOV",
    convertedNewDate.itinerary.includes("24NOV") && convertedNewDate.itinerary.includes("25NOV"),
    convertedNewDate.itinerary
  );

  clearLearned();
}

/* ====== AIRCRAFT TYPE EXTRACTION & MAPPING SPECIFICATION ====== */
{
  console.log("\n[Aircraft Extraction] user-supplied aircraft is primary source of truth");
  const { parseExplicitAircraftString } = await import("../src/lib/aircraft");

  // 17 explicit rules from user prompt
  const rules = [
    { name: "Boeing 737 MAX 9 Passenger", expected: "7M9" },
    { name: "Boeing 737 MAX 8 Passenger", expected: "7M8" },
    { name: "Boeing 737", expected: "73H" },
    { name: "Boeing 777", expected: "777" },
    { name: "Boeing 787", expected: "787" },
    { name: "Boeing 767", expected: "767" },
    { name: "Boeing A350", expected: "350" },
    { name: "Airbus A350", expected: "350" },
    { name: "Airbus A380", expected: "380" },
    { name: "Airbus A321", expected: "321" },
    { name: "Airbus A321neo", expected: "32N" },
    { name: "Airbus A320", expected: "320" },
    { name: "Airbus A220-300 Passenger", expected: "220" },
    { name: "Embraer 175", expected: "175" },
    { name: "Embraer 170", expected: "170" },
    { name: "Canadair RJ 900", expected: "900" },
    { name: "Bombardier Regional Jet 550", expected: "550" },
  ];

  for (const r of rules) {
    const code = parseExplicitAircraftString(r.name);
    check(`${r.name} -> ${r.expected}`, code === r.expected, `got: ${code}`);
  }

  // User's exact itinerary example
  const input = `UA 2379 — Boeing 737 MAX 9 Passenger
San Francisco (SFO) to Chicago (ORD) on Mon, May 10
8:00 AM to 2:15 PM (4h 15m)
Economy (Y)

UA 1916 — Boeing 737
Chicago (ORD) to Boston (BOS) on Mon, May 10
3:30 PM to 6:45 PM (2h 15m)
Economy (Y)

UA 1031 — Boeing 737 MAX 9 Passenger
Boston (BOS) to Chicago (ORD) on Fri, May 14
9:00 AM to 10:30 AM (2h 30m)
Economy (Y)

UA 2341 — Boeing 737
Chicago (ORD) to San Francisco (SFO) on Fri, May 14
12:00 PM to 2:45 PM (4h 45m)
Economy (Y)`;

  const r = convert(input);
  check("4 segments parsed", r.segments.length === 4, `got: ${r.segments.length}`);
  check(
    "1 UA 2379 has 7M9",
    r.itinerary.includes("1 UA 2379 10MAY SFO ORD 800A 215P 7M9"),
    r.itinerary
  );
  check(
    "2 UA 1916 has 73H",
    r.itinerary.includes("2 UA 1916 10MAY ORD BOS 330P 645P 73H"),
    r.itinerary
  );
  check(
    "3 UA 1031 has 7M9",
    r.itinerary.includes("3 UA 1031 14MAY BOS ORD 900A 1030A 7M9"),
    r.itinerary
  );
  check(
    "4 UA 2341 has 73H",
    r.itinerary.includes("4 UA 2341 14MAY ORD SFO 1200P 245P 73H"),
    r.itinerary
  );
  check(
    "no 'aircraft not found in the source' warning",
    !r.issues.some((i) => i.text.includes("aircraft not found in the source")),
    JSON.stringify(r.issues)
  );
  check(
    "no '---' equipment in output",
    !r.itinerary.includes("---"),
    r.itinerary
  );
}

/* ====== ELAPSED TIME vs LAYOVER DURATION (same-line rule) ====== */
{
  console.log("\n[Elapsed] flight duration kept regardless of layover line position");

  // A. Layover printed BELOW the flight (user's snippet)
  const below = `Albany (ALB) to Chicago (ORD) on Mon, Dec 28
9:05 AM to 11:05 AM (3h 0m)
United 5621 (operated by Skywest Dba United Express)
Embraer 175
First (Z) 
Layover in ORD (1h 50m)`;
  const rb = convert(below);
  check("layover below: elapsed 3.00 used", rb.itinerary.includes("905A 1105A 175 3.00"), rb.itinerary);
  check("layover below: no duration warning", !rb.issues.some((i) => i.text.includes("duration not stated")), JSON.stringify(rb.issues));
  check("layover below: 1h50m never used as elapsed", !rb.itinerary.includes("1.50"), rb.itinerary);

  // B. Layover printed ABOVE the flight, same paragraph
  const aboveSame = `Layover in ALB (1h 50m)
Albany (ALB) to Chicago (ORD) on Mon, Dec 28
9:05 AM to 11:05 AM (3h 0m)
United 5621 (operated by Skywest Dba United Express)
Embraer 175
First (Z) `;
  const ra = convert(aboveSame);
  check("layover above (same para): elapsed 3.00 used", ra.itinerary.includes("905A 1105A 175 3.00"), ra.itinerary);
  check("layover above (same para): no duration warning", !ra.issues.some((i) => i.text.includes("duration not stated")), JSON.stringify(ra.issues));

  // C. Layover printed ABOVE the flight, its own paragraph
  const aboveOwn = `Layover in ALB (1h 50m)

Albany (ALB) to Chicago (ORD) on Mon, Dec 28
9:05 AM to 11:05 AM (3h 0m)
United 5621 (operated by Skywest Dba United Express)
Embraer 175
First (Z) `;
  const rc = convert(aboveOwn);
  check("layover above (own para): elapsed 3.00 used", rc.itinerary.includes("905A 1105A 175 3.00"), rc.itinerary);
  check("layover above (own para): no duration warning", !rc.issues.some((i) => i.text.includes("duration not stated")), JSON.stringify(rc.issues));

  // D. Flight genuinely has NO duration — the layover's must NOT be borrowed
  const noDur = `Wichita (ICT) to Chicago (ORD) on Tue, Sep 22
10:55 AM to 1:02 PM
United 5810
Bombardier Regional Jet 550
Economy (B)
Layover in ORD (3h 23m)`;
  const rd = convert(noDur);
  check("no own duration: layover 3h23m never borrowed", !rd.itinerary.includes("3.23"), rd.itinerary);
  check("no own duration: duration warning removed per mandate", !rd.issues.some((i) => i.text.includes("duration not stated")));

  // E. ALB now resolves a confident timezone estimate
  const { estimateElapsed } = await import("../src/lib/airports");
  check("ALB has a known timezone", estimateElapsed("ALB", "ORD", 545, 665).confident);
}

/* ====== ERJ AIRCRAFT + AI PATH PARITY (duration & aircraft) ====== */
{
  console.log("\n[AI parity] ERJ aircraft + AI-supplied duration produce no false warnings");
  const { parseExplicitAircraftString } = await import("../src/lib/aircraft");
  const { toRawFlights } = await import("../src/lib/ai");
  const { convertFlights } = await import("../src/lib/converter");

  // ERJ family mapping
  check("Embraer ERJ-145 -> 145", parseExplicitAircraftString("Embraer ERJ-145") === "145", String(parseExplicitAircraftString("Embraer ERJ-145")));
  check("ERJ 145 -> 145", parseExplicitAircraftString("ERJ 145") === "145");
  check("EMB-145 -> 145", parseExplicitAircraftString("EMB-145") === "145");
  check("ERJ-135 -> 135", parseExplicitAircraftString("ERJ-135") === "135");
  check("ERJ-140 -> 140", parseExplicitAircraftString("ERJ-140") === "140");

  const input = `Albany (ALB) to Queenstown (ZQN) on Mon, Dec 28 Warning IconWarning Icon

Albany (ALB) to Philadelphia (PHL) on Mon, Dec 28
3:08 PM to 4:35 PM (1h 27m)
American 5806 (operated by Piedmont Airlines As American Eagle)
Embraer ERJ-145
Economy (Y) 
Layover in PHL (2h 0m)

Philadelphia (PHL) to Los Angeles (LAX) on Mon, Dec 28
6:35 PM to 9:50 PM (6h 15m)
American 897
Airbus A321neo
First (R) 
Layover in LAX (1h 45m)

Los Angeles (LAX) to Auckland (AKL) on Mon, Dec 28
11:35 PM to 9:55 AM (13h 20m)
American 83
Boeing 787
Business (R) 
Layover in AKL (4h 30m)

Auckland (AKL) to Queenstown (ZQN) on Wed, Dec 30
2:25 PM to 4:15 PM (1h 50m)
American 9035 (operated by Jetstar)
Airbus A320
Economy (Y) `;

  // LOCAL path
  const rl = convert(input);
  check("local: ERJ-145 -> 145 in output", rl.itinerary.includes("308P 435P 145 1.27"), rl.itinerary);
  check("local: no aircraft warning", !rl.issues.some((i) => i.text.includes("aircraft not found")), JSON.stringify(rl.issues));
  check("local: no duration warning", !rl.issues.some((i) => i.text.includes("duration not stated")), JSON.stringify(rl.issues));
  check("local: layover 2h/1h45/4h30 never used as elapsed", !/\s(2\.00|1\.45|4\.30)\s/.test(rl.itinerary), rl.itinerary);

  // AI path with the same facts
  const aiFlights = toRawFlights({
    flights: [
      { airline: "AA", flightNumber: 5806, origin: "ALB", destination: "PHL", date: { day: 28, month: 12 }, departure: "15:08", arrival: "16:35", durationMinutes: 87, aircraft: "Embraer ERJ-145", cabin: "ECONOMY", bookingClass: "Y", operatedBy: "Piedmont Airlines As American Eagle" },
      { airline: "AA", flightNumber: 897, origin: "PHL", destination: "LAX", date: { day: 28, month: 12 }, departure: "18:35", arrival: "21:50", durationMinutes: 375, aircraft: "Airbus A321neo", cabin: "FIRST", bookingClass: "R" },
      { airline: "AA", flightNumber: 83, origin: "LAX", destination: "AKL", date: { day: 28, month: 12 }, departure: "23:35", arrival: "09:55", arrivalDayOffset: 1, durationMinutes: 800, aircraft: "Boeing 787", cabin: "BUSINESS", bookingClass: "R" },
      { airline: "AA", flightNumber: 9035, origin: "AKL", destination: "ZQN", date: { day: 30, month: 12 }, departure: "14:25", arrival: "16:15", durationMinutes: 110, aircraft: "Airbus A320", cabin: "ECONOMY", bookingClass: "Y", operatedBy: "Jetstar" },
    ],
  });
  check("AI: duration parsed into elapsed", aiFlights[0].elapsed === 87 && aiFlights[3].elapsed === 110, JSON.stringify(aiFlights.map((f) => f.elapsed)));
  check("AI: ERJ-145 mapped to 145", aiFlights[0].equip === "145", String(aiFlights[0].equip));

  const ra = convertFlights(aiFlights, null);
  check("AI: no aircraft warning", !ra.issues.some((i) => i.text.includes("aircraft not found")), JSON.stringify(ra.issues));
  check("AI: no duration warning", !ra.issues.some((i) => i.text.includes("duration not stated")), JSON.stringify(ra.issues));
  check("AI output identical to local output", ra.itinerary === rl.itinerary, `\nAI:\n${ra.itinerary}\nLOCAL:\n${rl.itinerary}`);

  // duration string tolerance from models
  const flex = toRawFlights({
    flights: [
      { airline: "AA", flightNumber: 1, origin: "JFK", destination: "LAX", date: { day: 1, month: 6 }, departure: "08:00", arrival: "11:00", duration: "6h 15m", aircraft: "Boeing 777", cabin: "ECONOMY", bookingClass: "Y" },
      { airline: "AA", flightNumber: 2, origin: "LAX", destination: "JFK", date: { day: 5, month: 6 }, departure: "08:00", arrival: "16:30", elapsedMinutes: "330", aircraft: "Boeing 777", cabin: "ECONOMY", bookingClass: "Y" },
    ],
  });
  check("AI: '6h 15m' string -> 375", flex[0].elapsed === 375, String(flex[0].elapsed));
  check("AI: '330' string -> 330", flex[1].elapsed === 330, String(flex[1].elapsed));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
