import { convertToSabre as convert } from "../src/lib/converter";
import { shouldAutoRunAi } from "../src/lib/ai";
import { saveLearnedClass, clearLearnedClasses } from "../src/lib/cabinClasses";
import { canSaveItinerary, learnItinerary, findLearnedItinerary, forgetItineraryForText, clearLearned } from "../src/lib/learning";
import { shouldPrintOperatedBy } from "../src/lib/sabre";
import { ocrCleanText } from "../src/lib/parser";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

console.log("=== Testing Operator Priority & Carrier Aliases ===");
assert(!shouldPrintOperatedBy("AS", "Alaska Airlines"), "AS and Alaska Airlines are same carrier");
assert(!shouldPrintOperatedBy("AS", "ALASKA"), "AS and ALASKA are same carrier");
assert(!shouldPrintOperatedBy("AF", "Air France"), "AF and Air France are same carrier");
assert(!shouldPrintOperatedBy("LX", "Swiss"), "LX and Swiss are same carrier");
assert(!shouldPrintOperatedBy("LX", "SWISS INTERNATIONAL AIR LINES"), "LX and Swiss International Air Lines are same carrier");

// A carrier label immediately followed by a clock must not be parsed as a
// flight number (e.g. OCR text: "+ Swiss 4:50 AM"). Leg route rows remain the
// only route evidence until the AI can resolve the missing scheduled numbers.
const swissCardOcr = `$1,488 Off Retail AWD\n+ Swiss 4:50 AM — 5:30 PM · 23h 10m · BLR to MIA via ZRH\nBangalore (BLR) to Zürich (ZRH) · Mon, Dec 14\nLX 141 (Operated by Swiss)\n4:50 AM to 10:50 AM (10h 30m)\nAirbus A330-300 | Business Class (J)\n2h Layover · Zürich, Switzerland. This is a connecting flight in ZRH.\nZürich (ZRH) to Miami (MIA) · Mon, Dec 14\nLX 64 (Operated by Swiss)\n12:50 PM to 5:30 PM (10h 40m)\nBoeing 777-300ER | Business Class (Z)`;
const swissCardResult = convert(swissCardOcr, null);
assert(swissCardResult.segments.length === 2, `Swiss search card yields both legs, got ${swissCardResult.segments.length}`);
assert(!swissCardResult.segments.some((s) => s.airline === "LX" && s.num === "4"), "Swiss 4:50 AM is recognized as a time, never bogus flight LX 4");
const compactSwissClock = convert("+ Swiss 450AM to 530PM · 23h 10m · BLR to MIA via ZRH", null);
assert(!compactSwissClock.segments.some((s) => s.airline === "LX" && s.num === "450"), "OCR compact clock Swiss 450AM is never misread as flight LX 450");
assert(swissCardResult.itinerary === `1 LX 141 14DEC BLR ZRH 450A 1050A 333 10.30 0 N  CABIN-BUSINESS\n2 LX 64 14DEC ZRH MIA 1250P 530P 77W 10.40 0 N  CABIN-BUSINESS\n\n<--additional-->\n1 LX 141J 14DEC\n2 LX 64Z 14DEC`, "Swiss card produces both exact Sabre legs with separate classes and equipment");
assert(swissCardResult.outbound === "0LX141J14DECBLRZRHNN1§0LX64Z14DECZRHMIANN1", "Swiss connection outbound chain contains both NN1 sells");
assert(swissCardResult.individual === "1- 0LX141J14DECBLRZRHGK1\n2- 0LX64Z14DECZRHMIAGK1", "Swiss individual sells contain both numbered GK1 legs");

// Raw Tesseract output captured from the user's screenshot (including the
// merged card-row order, summary durations, OCR noise, and O→0 class confusion).
// This prevents a clean, hand-normalized fixture from hiding OCR-path bugs.
const fiveLegOcr = `al i . 7:25 AM 6:35 PM (12-04) 24h 40m MIA to BLR YYZ, DXB LS\n$7,492 @ Emirates, Air Canada\nLJ 8:20 PM (12-14) 9:50 AM (12-15) 24h Om BLR to MIA DXB 9\nMiami (MIA) to Bengaluru (BLR) on Thu, Dec 3 eo\n& Miami (MIA) to Toronto (YYZ) on Thu, Dec 3 7:25 AM to 10:39 AM (3h 14m)\nAir Canada 1643 (operated by Air Canada Rouge) Airbus A321 Business (P) # ¥{\n——— LAYOVER IN YYZ (3H 16M) ———\na Toronto (YYZ) to Dubai (DXB) on Thu, Dec 3 1:55 PM to 11:40 AM on Fri, Dec 4 (12h 45m)\nEmirates Emirates 242 Airbus A380 Business (0) ff\n———— LAYOVER IN DXB (1H 55M) ———\na Dubai (DXB) to Bengaluru (BLR) on Fri, Dec 4 1:35 PM to 6:35 PM (3h 30m)\nEmicates Emirates 566 Boeing 777 Business (0) ¥{\nBengaluru (BLR) to Miami (MIA) on Mon, Dec 14 9\na Bengaluru (BLR) to Dubai (DXB) on Mon, Dec 14 8:20 PM to 11:00 PM (4h 10m)\nEmirates Emirates 567 Boeing 777 Business (0) {\n——— LAYOVER IN DXB (3H 15M) ———\na Dubai (DXB) to Miami (MIA) on Tue, Dec 15 2:15 AM to 9:50 AM (16h 35m)\nEmicates Emirates 213 Boeing 777 Business (0) ¥{`;
const fiveLegResult = convert(ocrCleanText(fiveLegOcr), null);
assert(fiveLegResult.itinerary === `1 AC 1643 3DEC MIA YYZ 725A 1039A 321 3.14 0 N  CABIN-BUSINESS\n*MIA-YYZ OPERATED BY AIR CANADA ROUGE\n2 EK 242 3DEC YYZ DXB 155P 1140A¥1 380 12.45 0 N  CABIN-BUSINESS\n3 EK 566 4DEC DXB BLR 135P 635P 777 3.30 0 N  CABIN-BUSINESS\n4 EK 567 14DEC BLR DXB 820P 1100P 777 4.10 0 N  CABIN-BUSINESS\n5 EK 213 15DEC DXB MIA 215A 950A 777 16.35 0 N  CABIN-BUSINESS\n\n<--additional-->\n1 AC 1643P 3DEC\n2 EK 242O 3DEC\n3 EK 566O 4DEC\n4 EK 567O 14DEC\n5 EK 213O 15DEC`, "Five-leg itinerary keeps per-flight dates, durations, classes, equipment and Rouge operator");
assert(fiveLegResult.outbound === "0AC1643P3DECMIAYYZNN1§0EK242O3DECYYZDXBNN1§0EK566O4DECDXBBLRNN1", "Five-leg outbound chain has the three outbound flights");
assert(fiveLegResult.inbound === "0EK567O14DECBLRDXBNN1§0EK213O15DECDXBMIANN1", "Five-leg inbound chain has the two return flights");
assert(fiveLegResult.individual === "1- 0AC1643P3DECMIAYYZGK1\n2- 0EK242O3DECYYZDXBGK1\n3- 0EK566O4DECDXBBLRGK1\n4- 0EK567O14DECBLRDXBGK1\n5- 0EK213O15DECDXBMIAGK1", "Five individual GK1 entries remain numbered in itinerary order");

assert(
  ocrCleanText("Business Class (0) · Business Class (2) · Al 2409 · 9:50 PM*!") ===
    "Business Class (O) · Business Class (Z) · AI 2409 · 9:50 PM+1",
  "OCR class, Air India code, and overnight marker confusions are repaired from context"
);

// This reproduces the next screenshot's full-page OCR plus the recovered
// fine-print lines from the overlapping detail pass. It ensures summary-bar
// clocks like Swiss 450AM cannot become a bogus LX 450 flight or overwrite the
// preceding Air India leg's arrival time.
const uaSwissOcr = `»/,690 UIT Retall AWD ©)\n2:42 PM 8:50 AM\nMultiple Airlin... — 31h 38m MIA to BLR EWR, DEL ®o\nES P Dec 05, 2026 ’ Dec 07, 2026 ' nd\nMiami (MIA) to Bangalore (BLR) on Sat, Dec 5\nfe) &) Miami (MIA) to New York (EWR) © Sat, Dec 5 0] 2:42 PM to 5:53 PM ¢ (3h 11m)\nUA 2231 (Operated by United Airlines) Boeing 737 MAX 9 | First Class (J)\n| 2h 42m Layover ® New York, United States. This is a connecting flight in EWR.\nfe) 8 New York (EWR) to New Delhi (DEL) « Sat, Dec 5 0] 8:35 PM to 9:50 PM*! © (14h 45m)\nUA 82 (Operated by United Airlines) Boeing 787-9 | Business Class\n| 8h 10m Layover e New Delhi, India. This is a connecting flight in DEL.\nfe) [«] New Delhi (DEL) to Bangalore (BLR) * Mon, Dec 7 () 6:00 AM to 5:30 PM « (2h 50m)\nAl 2409 (Operated by Air India) Airbus A321-100/200 | Business Class (D)\n== Swiss 450AM 530PM 23h 10m BLR to MIA ZRH\nDec 14, 2026 Dec 14, 2026\nBangalore (BLR) to Miami (MIA) on Mon, Dec 14\n®) == Bangalore (BLR) to Zurich (ZRH) * Mon, Dec 14 0) 4:50 AM to 10:50 AM » (10h 30m)\nLX 141 (Operated by Swiss) Airbus A330-300 | Business Class (2)\n| 2h Layover e Zurich, Switzerland. This is a connecting flight in ZRH.\nO | Zurich (ZRH) to Miami (MIA) « Mon, Dec 14 (J 12:50 PM to 5:30 PM « (10h 40m)\nLX 64 (Operated by Swiss) Boeing 777-300ER | Business Class (2)`;
const uaSwissResult = convert(ocrCleanText(uaSwissOcr), null);
assert(uaSwissResult.segments.length === 5, `All five flights survive actual OCR layout, got ${uaSwissResult.segments.length}`);
assert(uaSwissResult.segments.map((s) => `${s.airline}${s.num}`).join(",") === "UA2231,UA82,AI2409,LX141,LX64", "OCR flight identities remain in order with no false LX450");
assert(uaSwissResult.segments[2]?.arr === 17 * 60 + 30, "AI 2409 arrival is 5:30 PM as specified");
assert(uaSwissResult.segments[3]?.bookingClass === "Z" && uaSwissResult.segments[4]?.bookingClass === "Z", "Swiss Z-class OCR confusion resolves to Z for both Z-class legs");
assert(uaSwissResult.itinerary === `1 UA 2231 5DEC MIA EWR 242P 553P 7M9 3.11 0 N  CABIN-FIRST\n2 UA 82 5DEC EWR DEL 835P 950P¥1 789 14.45 0 N  CABIN-BUSINESS\n3 AI 2409 7DEC DEL BLR 600A 530P 321 2.50 0 N  CABIN-BUSINESS\n4 LX 141 14DEC BLR ZRH 450A 1050A 333 10.30 0 N  CABIN-BUSINESS\n5 LX 64 14DEC ZRH MIA 1250P 530P 77W 10.40 0 N  CABIN-BUSINESS\n\n<--additional-->\n1 UA 2231J 5DEC\n2 UA 82J 5DEC\n3 AI 2409D 7DEC\n4 LX 141Z 14DEC\n5 LX 64Z 14DEC`, "Screenshot itinerary yields correct dates, equipment, cabins, and classes");
assert(uaSwissResult.outbound === "0UA2231J5DECMIAEWRNN1§0UA82J5DECEWRDELNN1§0AI2409D7DECDELBLRNN1", "United/Air India outbound three-leg chain matches sequence");
assert(uaSwissResult.inbound === "0LX141Z14DECBLRZRHNN1§0LX64Z14DECZRHMIANN1", "Swiss inbound two-leg chain preserves Z class");
assert(uaSwissResult.individual === "1- 0UA2231J5DECMIAEWRGK1\n2- 0UA82J5DECEWRDELGK1\n3- 0AI2409D7DECDELBLRGK1\n4- 0LX141Z14DECBLRZRHGK1\n5- 0LX64Z14DECZRHMIAGK1", "All five numbered GK1 commands match the requested output");
assert(shouldPrintOperatedBy("AS", "Horizon Air"), "AS and Horizon Air are different (regional subsidiary)");
assert(shouldPrintOperatedBy("AF", "Indigo"), "AF and Indigo are different");
assert(shouldPrintOperatedBy("UA", "SkyWest Airlines"), "UA and SkyWest are different");

// Priority 1: Stated operator in text
const statedIndigo = `Air France 3775
BLR → VTZ
Wed, Dec 4
Departure 9:05 AM · Arrival 10:45 AM
Economy (B)
Duration: 1 hr 40 min
A320
Operated by IndiGo`;
const rStated = convert(statedIndigo, null);
assert(rStated.itinerary.includes("*BLR-VTZ OPERATED BY INDIGO"), "Priority 1: Stated operator printed in UPPERCASE");

// Same airline stated in text -> no operated-by line
const statedSame = `Alaska Airlines 119
SEA → SFO
Wed, Dec 4
Departure 9:00 AM · Arrival 11:00 AM
Economy (Y)
Duration: 2 hr 0 min
Boeing 737
Operated by Alaska Airlines`;
const rSame = convert(statedSame, null);
assert(!rSame.itinerary.includes("OPERATED BY"), "Same airline in text prints NO operated-by line");

// Regional subsidiary stated in text -> printed
const statedRegional = `Alaska Airlines 2010
SEA → YVR
Wed, Dec 4
Departure 1:00 PM · Arrival 2:00 PM
Economy (Y)
Duration: 1 hr 0 min
Embraer 175
Operated by Horizon Air`;
const rReg = convert(statedRegional, null);
assert(rReg.itinerary.includes("*SEA-YVR OPERATED BY HORIZON AIR"), "Regional carrier prints operated-by line");

// Priority 2 & 3: Star flag + Known flights table
const gdsStarIndigo = `3 AF*3775 B 04DEC BLR VTZ 0905 1045
320 1.40 0 N CABIN-ECONOMY`;
const rGdsStar = convert(gdsStarIndigo, null);
assert(rGdsStar.itinerary.includes("*BLR-VTZ OPERATED BY INDIGO"), "Star flag on AF*3775 resolves INDIGO via known flight table");

console.log("=== Testing 6-flight Itinerary with Unknown Class Z ===");
const af6Flight = `1 AF 6453 B 04DEC VTZ BLR 0600 0745
320 1.45 0 N CABIN-ECONOMY
2 AF 3775 B 04DEC BLR VTZ 0905 1045
320 1.40 0 N CABIN-ECONOMY
3 AF*3775 B 04DEC BLR VTZ 0905 1045
*VTZ-BLR OPERATED BY INDIGO
4 AF*6453 B 07DEC VTZ BLR 1735 1920
*BLR-VTZ OPERATED BY INDIGO
5 AF 191 Z 05APR BLR CDG 0145 0800
777 9.45 0 N CABIN-BUSINESS
6 AF 050 Z 05APR CDG ORD 1145 1355
777 9.10 0 N CABIN-BUSINESS`;

clearLearnedClasses();
const r6 = convert(af6Flight, null);
assert(r6.segments.length === 6, `All 6 segments parsed immediately, got ${r6.segments.length}`);
assert(r6.unknownClassQuestions.length === 1, `Unknown class question generated for AF Z, got ${r6.unknownClassQuestions.length}`);
assert(r6.unknownClassQuestions[0].airline === "AF" && r6.unknownClassQuestions[0].classLetter === "Z", "Question targets AF Z");
assert(r6.segments[4].bookingClass === "Z" && r6.segments[5].bookingClass === "Z", "Booking class letter Z preserved, never replaced");

// Learn AF Z = BUSINESS
saveLearnedClass("AF", "Z", "BUSINESS");
const r6Learned = convert(af6Flight, null);
assert(r6Learned.unknownClassQuestions.length === 0, "No unknown class question after learning AF Z");
assert(r6Learned.segments[4].cabin === "BUSINESS", "Learned cabin applied to segment 5");

console.log("=== Testing Auto-run AI Criteria ===");
// Case A: Missing equipment "---"
const equipMissingText = `AF 123
JFK → CDG
Wed, Dec 4
Departure 6:00 PM · Arrival 7:00 AM +1
Economy (Y)
Duration: 7 hr 0 min`;
const rMissingEquip = convert(equipMissingText, null);
assert(rMissingEquip.segments[0].equip === "---", "Equip is ---");
assert(shouldAutoRunAi(rMissingEquip), "shouldAutoRunAi is true when equip is ---");

// Case B: Star flight missing operator
const starMissingOpText = `AF*9999 04DEC CDG JFK 1000 1300 777 8.00 0 N CABIN-ECONOMY`;
const rStarMissing = convert(starMissingOpText, null);
assert(rStarMissing.segments[0].hasStarFlag === true, "Segment has star flag");
assert(!rStarMissing.segments[0].operatedBy, "Operator is unknown");
assert(shouldAutoRunAi(rStarMissing), "shouldAutoRunAi is true when star flight lacks operator");

// Case C: Unknown class letter
clearLearnedClasses();
const unknownClassText = `AF 191 Z 05APR BLR CDG 0145 0800 777 9.45 0 N CABIN-BUSINESS`;
const rUnknownClass = convert(unknownClassText, null);
assert(rUnknownClass.unknownClassQuestions.length > 0, "Has unknown class question");
assert(shouldAutoRunAi(rUnknownClass), "shouldAutoRunAi is true when class letter is unconfirmed/unlearned");

console.log("=== Testing Safe-Save Safeguards ===");
clearLearned();
// Reject save with "---"
const badRawFlights = [
  {
    airline: "AF",
    flightNumber: 123,
    origin: "JFK",
    dest: "CDG",
    equip: "---",
    dep: 600,
    arr: 1200,
  } as any,
];
assert(!canSaveItinerary(badRawFlights), "canSaveItinerary returns false when equip is ---");
const learnedBad = learnItinerary(equipMissingText, badRawFlights);
assert(learnedBad === null, "learnItinerary does not persist incomplete data");

// Reject save with star flag and missing operator
const badStarFlight = [
  {
    airline: "AF",
    flightNumber: 9999,
    origin: "CDG",
    dest: "JFK",
    equip: "777",
    hasStarFlag: true,
    operatedBy: undefined,
  } as any,
];
assert(!canSaveItinerary(badStarFlight), "canSaveItinerary returns false when star flight missing operator");

// Valid flight can be saved and cleared
const goodText = `United Airlines 123
JFK → SFO
Wed, Dec 4
Departure 8:00 AM · Arrival 11:00 AM
Boeing 777
Economy (Y)`;

const goodFlights = [
  {
    airline: "UA",
    flightNumber: 123,
    origin: "JFK",
    dest: "SFO",
    equip: "777",
    dep: 480,
    arr: 660,
  } as any,
];
assert(canSaveItinerary(goodFlights), "canSaveItinerary returns true for valid flights");
const learnedGood = learnItinerary(goodText, goodFlights);
assert(learnedGood !== null, "learnItinerary persists valid data");
assert(findLearnedItinerary(goodText) !== null, "findLearnedItinerary finds it");
forgetItineraryForText(goodText);
assert(findLearnedItinerary(goodText) === null, "forgetItineraryForText clears it");

console.log("=== Testing Duration Warning Removal ===");
const noDurationText = `United Airlines 100
JFK → SFO
Wed, Dec 4
Departure 9:00 AM · Arrival 12:00 PM
Boeing 777
Economy (Y)`;
const rNoDur = convert(noDurationText, null);
assert(!rNoDur.issues.some((i) => i.text.toLowerCase().includes("duration not stated")), "Duration not stated warning never raised");

console.log("=== Testing GDS Codeshare & Screenshot Scenarios ===");
const dl8727Text = `1  DL*8727  Z 02MAR  LAX CDG  655P 250P¥1
AIR FRANCE &&`;
const rDl = convert(dl8727Text, null);
assert(rDl.segments.length === 1, "DL 8727 parsed");
assert(rDl.segments[0].operatedBy === "AIR FRANCE", "Operator resolved from AIR FRANCE && line");
assert(rDl.segments[0].equip === "77W", "Equipment resolved as 77W");
assert(rDl.itinerary.includes("02MAR"), "02MAR formatted with leading zero");
assert(rDl.itinerary.includes("*LAX-CDG OPERATED BY AIR FRANCE"), "Emits operated-by line for Air France");
assert(!rDl.itinerary.includes("---"), "Output does not contain --- equipment");

const uaCodesharesText = `1  UA*8466  P 03MAR  LAX YUL  830A 443P
AIR CANADA &&
2  UA*8062  P 03MAR  YUL CDG  615P 720A¥1
AIR CANADA &&
3  UA*9516  P 18MAR  CDG FRA  640A 755A
LUFTHANSA UTSCHE LUFTHANSA AG &&
4  UA*8845  P 18MAR  FRA LAX  1025A 205P
LUFTHANSA UTSCHE LUFTHANSA AG`;
const rUa = convert(uaCodesharesText, null);
assert(rUa.segments.length === 4, "All 4 UA codeshare flights parsed");
assert(rUa.segments[0].operatedBy === "AIR CANADA", "UA 8466 operator is AIR CANADA");
assert(rUa.segments[0].equip === "223", "UA 8466 equip resolved");
assert(rUa.segments[1].operatedBy === "AIR CANADA", "UA 8062 operator is AIR CANADA");
assert(rUa.segments[1].equip === "77W", "UA 8062 equip resolved");
assert(Boolean(rUa.segments[2].operatedBy?.includes("LUFTHANSA")), "UA 9516 operator is LUFTHANSA");
assert(rUa.segments[2].equip === "320", "UA 9516 equip resolved");
assert(Boolean(rUa.segments[3].operatedBy?.includes("LUFTHANSA")), "UA 8845 operator is LUFTHANSA");
assert(rUa.segments[3].equip === "748", "UA 8845 equip resolved");
assert(!rUa.itinerary.includes("---"), "All equipment resolved without ---");

const baText = `1   BA  043   T 3MAY   LHR CPT   910P 950A¥1
2   BA  056   T 16MAY  JNB LHR   725P 535A¥1`;
const rBa = convert(baText, null);
assert(rBa.segments.length === 2, "BA segments parsed");
assert(rBa.segments[0].cabin === "PREMIUM", "BA 043 class T is PREMIUM");
assert(rBa.segments[0].equip === "788", "BA 043 equip is 788");
assert(rBa.segments[0].elapsed === 700, "BA 043 elapsed is 11.40 (700 min)");
assert(rBa.segments[1].cabin === "PREMIUM", "BA 056 class T is PREMIUM");
assert(rBa.segments[1].equip === "388", "BA 056 equip is 388");
assert(rBa.segments[1].elapsed === 670, "BA 056 elapsed is 11.10 (670 min)");
assert(rBa.itinerary.includes("1 BA 043 03MAY LHR CPT 910P 950A¥1 788 11.40 0 N  CABIN-PREMIUM"), "BA 043 itinerary line matches");
assert(rBa.itinerary.includes("2 BA 056 16MAY JNB LHR 725P 535A¥1 388 11.10 0 N  CABIN-PREMIUM"), "BA 056 itinerary line matches");
assert(rBa.outbound === "0BA043T03MAYLHRCPTNN1", "BA outbound NN1 matches");
assert(rBa.inbound === "0BA056T16MAYJNBLHRNN1", "BA inbound NN1 matches");
assert(rBa.individual.includes("0BA043T03MAYLHRCPTGK1"), "BA 043 GK1 matches");
assert(rBa.individual.includes("0BA056T16MAYJNBLHRGK1"), "BA 056 GK1 matches");
assert(!rBa.itinerary.includes("OPERATED BY"), "No operated by line for British Airways");

console.log("ALL REQUIREMENTS VERIFIED SUCCESSFULLY!");
