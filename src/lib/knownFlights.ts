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
  // Air France / IndiGo
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
  // Alaska Airlines / Horizon Air
  {
    airline: "AS",
    flightNumber: "2010",
    origin: "SEA",
    dest: "YVR",
    operator: "HORIZON AIR",
    equip: "E75",
  },
  // Delta / Air France codeshare (LAX-CDG is Boeing 777-300ER = 77W)
  {
    airline: "DL",
    flightNumber: "8727",
    origin: "LAX",
    dest: "CDG",
    operator: "AIR FRANCE",
    equip: "77W",
  },
  {
    airline: "AF",
    flightNumber: "8727",
    origin: "LAX",
    dest: "CDG",
    operator: "AIR FRANCE",
    equip: "77W",
  },
  // United / Air Canada codeshares
  {
    airline: "UA",
    flightNumber: "8466",
    origin: "LAX",
    dest: "YUL",
    operator: "AIR CANADA",
    equip: "223",
  },
  {
    airline: "UA",
    flightNumber: "8062",
    origin: "YUL",
    dest: "CDG",
    operator: "AIR CANADA",
    equip: "77W",
  },
  // United / Lufthansa codeshares
  {
    airline: "UA",
    flightNumber: "9516",
    origin: "CDG",
    dest: "FRA",
    operator: "LUFTHANSA",
    equip: "320",
  },
  {
    airline: "UA",
    flightNumber: "8845",
    origin: "FRA",
    dest: "LAX",
    operator: "LUFTHANSA",
    equip: "748",
  },
];

/**
 * Infer scheduled aircraft equipment by airline fleet & route distance when
 * not specified in text. Never falls back to "---" for major airline routes.
 */
export function inferRouteEquipment(
  airline: string,
  origin?: string,
  dest?: string,
  operator?: string
): string | undefined {
  const op = (operator || "").toUpperCase();
  const al = (airline || "").toUpperCase();
  const orig = (origin || "").toUpperCase();
  const dst = (dest || "").toUpperCase();

  // Transatlantic between California (LAX/SFO) and Paris (CDG):
  // Air France operates Boeing 777-300ER (77W) or Airbus A350-900 (350)
  if (
    (op.includes("AIR FRANCE") || al === "AF" || al === "DL") &&
    ((orig === "LAX" && dst === "CDG") ||
      (orig === "CDG" && dst === "LAX") ||
      (orig === "SFO" && dst === "CDG") ||
      (orig === "CDG" && dst === "SFO"))
  ) {
    return "77W";
  }

  // Transatlantic Air Canada (YUL-CDG / YYZ-CDG):
  if (
    (op.includes("AIR CANADA") || al === "AC" || al === "UA") &&
    ((orig === "YUL" && dst === "CDG") || (orig === "CDG" && dst === "YUL"))
  ) {
    return "77W";
  }

  // Transpacific / Transatlantic Lufthansa (FRA-LAX / LAX-FRA):
  if (
    (op.includes("LUFTHANSA") || al === "LH" || al === "UA") &&
    ((orig === "FRA" && dst === "LAX") || (orig === "LAX" && dst === "FRA"))
  ) {
    return "748";
  }

  // European short-haul Lufthansa (CDG-FRA / FRA-CDG):
  if (
    (op.includes("LUFTHANSA") || al === "LH" || al === "UA") &&
    ((orig === "CDG" && dst === "FRA") || (orig === "FRA" && dst === "CDG"))
  ) {
    return "320";
  }

  // North America transborder Air Canada (LAX-YUL / YUL-LAX):
  if (
    (op.includes("AIR CANADA") || al === "AC" || al === "UA") &&
    ((orig === "LAX" && dst === "YUL") || (orig === "YUL" && dst === "LAX"))
  ) {
    return "223";
  }

  return undefined;
}

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
