/**
 * Known-flight table.
 * Check it before searching online for operating carrier or equipment.
 *
 * Specific entries requested:
 *  - AF 6453 VTZ-BLR = INDIGO (A320 equipment)
 *  - AF 3775 BLR-VTZ = INDIGO (A320 equipment)
 *  - AS 2010 SEA-YVR = HORIZON AIR (E75 equipment)
 */

export interface KnownFlight {
  airline: string;
  flightNumber: string;
  origin?: string;
  dest?: string;
  operator: string;
  equip?: string;
}

export const KNOWN_FLIGHTS: KnownFlight[] = [
  {
    airline: "AF",
    flightNumber: "6453",
    origin: "VTZ",
    dest: "BLR",
    operator: "INDIGO",
    equip: "320",
  },
  {
    airline: "AF",
    flightNumber: "3775",
    origin: "BLR",
    dest: "VTZ",
    operator: "INDIGO",
    equip: "320",
  },
  {
    airline: "AS",
    flightNumber: "2010",
    origin: "SEA",
    dest: "YVR",
    operator: "HORIZON AIR",
    equip: "E75",
  },
];

export function lookupKnownFlight(
  airline: string,
  flightNumber: string,
  origin?: string,
  dest?: string
): KnownFlight | undefined {
  const al = (airline || "").toUpperCase().trim();
  const num = String(flightNumber || "").replace(/^0+/, "").trim();
  const orig = origin ? origin.toUpperCase().trim() : undefined;
  const dst = dest ? dest.toUpperCase().trim() : undefined;

  return KNOWN_FLIGHTS.find((k) => {
    if (k.airline !== al) return false;
    if (k.flightNumber.replace(/^0+/, "").trim() !== num) return false;
    if (orig && k.origin && k.origin !== orig) return false;
    if (dst && k.dest && k.dest !== dst) return false;
    return true;
  });
}
