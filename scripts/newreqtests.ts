import { convertToSabre as convert } from "../src/lib/converter";
import { shouldAutoRunAi } from "../src/lib/ai";
import { saveLearnedClass, clearLearnedClasses } from "../src/lib/cabinClasses";
import { canSaveItinerary, learnItinerary, findLearnedItinerary, forgetItineraryForText, clearLearned } from "../src/lib/learning";
import { shouldPrintOperatedBy } from "../src/lib/sabre";

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

console.log("ALL REQUIREMENTS VERIFIED SUCCESSFULLY!");
