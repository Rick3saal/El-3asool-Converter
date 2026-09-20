import { convertToSabre } from "../src/lib/converter";

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

const r = convertToSabre(input, null);
console.log("SEGMENTS:", r.segments.length, "ISSUES:", r.issues.length);
for (const i of r.issues) console.log("  -", i.level, i.text);
console.log("--- ITINERARY ---");
console.log(r.itinerary);
console.log("--- OUTBOUND ---");
console.log(r.outbound);
console.log("--- INBOUND ---");
console.log(r.inbound);
console.log("--- INDIVIDUAL ---");
console.log(r.individual);

// expectations
const expectItin = `1 CX 841 15MAR JFK HKG 1000A 205P¥1 350 16.05 0 N  CABIN-BUSINESS
2 CX 500 16MAR HKG NRT 325P 820P 330 3.55 0 N  CABIN-BUSINESS
3 CX 505 31MAR NRT HKG 630P 1020P 777 4.50 0 N  CABIN-BUSINESS
4 CX 844 1APR HKG JFK 225A 600A 350 15.35 0 N  CABIN-BUSINESS

<--additional-->
1 CX 841P 15MAR
2 CX 500P 16MAR
3 CX 505P 31MAR
4 CX 844P 1APR`;
const expectOut = "0CX841P15MARJFKHKGNN1§0CX500P16MARHKGNRTNN1";
const expectIn = "0CX505P31MARNRTHKGNN1§0CX844P1APRHKGJFKNN1";

/** Fail (exit 1) instead of only printing — this script gates `npm run check`. */
let failures = 0;
function check(label: string, actual: string, expected: string) {
  if (actual === expected) {
    console.log(`${label} MATCH: true`);
    return;
  }
  failures++;
  console.log(`${label} MATCH: false`);
  console.log("--- EXPECTED ---\n" + expected);
  console.log("--- ACTUAL ---\n" + actual);
}

console.log("");
check("ITINERARY", r.itinerary, expectItin);
check("OUTBOUND", r.outbound, expectOut);
check("INBOUND", r.inbound, expectIn);

if (failures > 0) {
  console.log(`\n==== cathaycheck: ${failures} failure(s) ====`);
  process.exit(1);
}
console.log("\n==== cathaycheck: all 3 blocks match ====");
