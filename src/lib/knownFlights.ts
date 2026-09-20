/**
 * Built-in knowledge of specific notable flights.
 *
 * Used ONLY to fill in what the source does not say:
 *  - equipment code when the source gives no aircraft
 *  - operating carrier when the source names no operator (e.g. Style A's
 *    "AS*2010" flag tells us the flight is not operated by Alaska metal —
 *    the table says Horizon Air does it).
 *
 * The user's source always wins: if the text names a different operator or a
 * different aircraft for the same flight, the source is used and the table
 * entry is ignored for that field.
 */

export interface KnownFlight {
  airline: string;
  number: string;
  /** optional route constraint — entry only applies to this city pair */
  origin?: string;
  dest?: string;
  /** Sabre equipment code */
  equip?: string;
  /** raw aircraft family name, kept for reference/learning */
  equipRaw?: string;
  /** operating carrier as it should print, e.g. "HORIZON AIR" */
  operatedBy?: string;
}

const KNOWN_FLIGHTS: KnownFlight[] = [
  // Alaska Airlines transpacific pair (Boeing 787-9, Alaska metal)
  { airline: "AS", number: "119", origin: "SEA", dest: "ICN", equip: "789", equipRaw: "Boeing 787-9" },
  { airline: "AS", number: "120", origin: "ICN", dest: "SEA", equip: "789", equipRaw: "Boeing 787-9" },
  // Alaska 2010 SEA-YVR is Horizon Air (Embraer 175)
  { airline: "AS", number: "2010", origin: "SEA", dest: "YVR", equip: "E75", equipRaw: "Embraer 175", operatedBy: "HORIZON AIR" },
];

export function lookupKnownFlight(
  airline: string,
  number: string,
  origin?: string,
  dest?: string
): KnownFlight | null {
  for (const k of KNOWN_FLIGHTS) {
    if (k.airline !== airline || k.number !== number) continue;
    if (k.origin && k.dest && (origin || dest)) {
      if (k.origin !== origin || k.dest !== dest) continue;
    }
    return k;
  }
  return null;
}
