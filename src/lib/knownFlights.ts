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
  // British Airways long-haul flights
  {
    airline: "BA",
    flightNumber: "43",
    origin: "LHR",
    dest: "CPT",
    operator: "BRITISH AIRWAYS",
    equip: "788",
  },
  {
    airline: "BA",
    flightNumber: "043",
    origin: "LHR",
    dest: "CPT",
    operator: "BRITISH AIRWAYS",
    equip: "788",
  },
  {
    airline: "BA",
    flightNumber: "56",
    origin: "JNB",
    dest: "LHR",
    operator: "BRITISH AIRWAYS",
    equip: "388",
  },
  {
    airline: "BA",
    flightNumber: "056",
    origin: "JNB",
    dest: "LHR",
    operator: "BRITISH AIRWAYS",
    equip: "388",
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
  // User-confirmed operator for this American-marketed British Airways codeshare.
  // Aircraft remains date/season-sensitive, so use BA's route prior below.
  {
    airline: "AA",
    flightNumber: "6994",
    origin: "LHR",
    dest: "JFK",
    operator: "BRITISH AIRWAYS",
  },
  // User supplied schedule details for these Delta-marketed, Air France-operated flights.
  { airline: "DL", flightNumber: "8698", origin: "MIA", dest: "CDG", operator: "AIR FRANCE", equip: "77W" },
  { airline: "DL", flightNumber: "8461", origin: "CDG", dest: "BLR", operator: "AIR FRANCE", equip: "789" },
  { airline: "DL", flightNumber: "8471", origin: "BLR", dest: "CDG", operator: "AIR FRANCE", equip: "789" },
  { airline: "DL", flightNumber: "8699", origin: "CDG", dest: "MIA", operator: "AIR FRANCE", equip: "77W" },
  { airline: "DL", flightNumber: "1211", origin: "MIA", dest: "ATL", operator: "DELTA AIR LINES", equip: "757" },
];

export interface FleetRouteGuess {
  /** Primary code supplied by the user; alternatives are informational only. */
  equip: string;
  alternatives: string[];
}

const AIRPORT_GROUPS = {
  us: new Set("ATL AUS ANC BNA BOS BWI CLT CLE CLT CMH CVG DAL DCA DEN DFW DTW EWR FLL IAD IAH JFK LAS LAX LGA MCO MCI MIA MKE MSP MSY ORD PHL PHX PIT PDX RDU SAN SFO SJC SLC SEA TPA TUL ITO HNL OGG KOA LIH ELP ABQ SAT STL BDL PBI RSW JAX BUF ROC SYR PVD PWM SNA OAK SMF ONT BUR LGB TUS BOI GEG RNO ANC FAI JNU".split(" ")),
  canada: new Set("YYZ YUL YVR YYC YOW YEG YHZ YWG YQB YQR YQT YSJ YFC YQM YLW YXS YXX YXE YQR YZF YFB".split(" ")),
  uk: new Set("LHR LGW LCY STN LTN MAN EDI GLA BHX BRS NCL".split(" ")),
  europe: new Set("LHR LGW LCY STN LTN MAN EDI GLA BHX BRS NCL CDG ORY FRA MUC BER HAM DUS CGN STR HAJ NUE LEJ AMS BRU ZRH GVA BSL VIE SZG MAD BCN AGP PMI VLC SVQ LIS OPO FAO FCO MXP LIN VCE NAP BGY PSA CTA CPH OSL ARN HEL KEF WAW KRK GDN PRG BUD BEG SOF ZAG LJU ATH SKG HER IST SAW OTP KBP VNO RIX TLL TIA TGD SKP".split(" ")),
  india: new Set("DEL BOM MAA BLR HYD CCU VTZ GOX TRV IXC ATQ GAU JAI LKO IXB PAT SXR BBI NAG IDR IXR VNS COK AMD GOI PNQ".split(" ")),
  gulf: new Set("DXB SHJ AUH DOH BAH KWI MCT RUH JED DMM MED".split(" ")),
  middleEast: new Set("DXB SHJ AUH DOH BAH KWI MCT RUH JED DMM MED AMM TLV BEY".split(" ")),
  africa: new Set("CAI HUR LXR SSH ALY ADD NBO DAR EBB JNB CPT DUR CMN RAK TUN ALG LOS ACC ABV DKR MRU SEZ".split(" ")),
  longHaulAfrica: new Set("JNB CPT NBO LOS ACC ADD DAR EBB".split(" ")),
  asia: new Set("NRT HND KIX NGO FUK CTS OKA ICN GMP PUS CJU PEK PVG SHA CAN SZX CTU HGH WUH XIY NKG CKG KMG TSN TAO HKG MFM TPE TSA KHH RMQ BKK DMK CNX HKT SIN KUL CGK DPS SUB MNL CRK SGN HAN DAD PNH REP RGN VTE DAC KTM CMB KHI LHE ISB TAS ALA FRU".split(" ")),
  australia: new Set("SYD MEL BNE PER ADL CBR OOL AKL WLG CHC NAN".split(" ")),
  caribbean: new Set("SJU NAS MBJ PUJ SDQ AUA CUR SXM BGI GCM STT STX POS GEO KIN ANU UVF".split(" ")),
  mexico: new Set("MEX CUN GDL MTY BJX SJD PVR".split(" ")),
  centralAmerica: new Set("GUA SJO PTY SAL LIR BZE MGA".split(" ")),
  southAmerica: new Set("BOG UIO GYE LIM SCL EZE AEP GIG GRU BSB SSA REC CNF POA MVD ASU LPB VVI".split(" ")),
} as const;

function between(a: string, b: string, left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return (left.has(a) && right.has(b)) || (left.has(b) && right.has(a));
}

function operatorCode(operator: string): string | undefined {
  const op = operator.toUpperCase();
  if (/BRITISH AIRWAYS/.test(op)) return "BA";
  if (/AMERICAN AIRLINES|AMERICAN EAGLE/.test(op)) return "AA";
  if (/DELTA/.test(op)) return "DL";
  if (/UNITED/.test(op)) return "UA";
  if (/JETBLUE/.test(op)) return "B6";
  if (/ALASKA/.test(op)) return "AS";
  if (/HAWAIIAN/.test(op)) return "HA";
  if (/SOUTHWEST/.test(op)) return "WN";
  if (/IBERIA/.test(op)) return "IB";
  if (/SAUDIA/.test(op)) return "SV";
  if (/ROYAL JORDANIAN/.test(op)) return "RJ";
  if (/LUFTHANSA/.test(op)) return "LH";
  if (/AIR FRANCE/.test(op)) return "AF";
  if (/KLM/.test(op)) return "KL";
  if (/VIRGIN ATLANTIC/.test(op)) return "VS";
  if (/TURKISH/.test(op)) return "TK";
  if (/EMIRATES/.test(op)) return "EK";
  if (/QATAR/.test(op)) return "QR";
  if (/ETIHAD/.test(op)) return "EY";
  if (/EGYPTAIR/.test(op)) return "MS";
  if (/AIR INDIA/.test(op)) return "AI";
  if (/AIR CANADA/.test(op)) return "AC";
  if (/AEROMEXICO/.test(op)) return "AM";
  if (/COPA/.test(op)) return "CM";
  if (/LATAM/.test(op)) return "LA";
  if (/AVIANCA/.test(op)) return "AV";
  return undefined;
}

function guess(equip: string, alternatives: string[] = []): FleetRouteGuess {
  return { equip, alternatives };
}

/**
 * User-supplied, deliberately approximate route/fleet priors. These are the
 * first-choice codes from the supplied reference, not live schedule facts.
 * They are used only when the source, exact-flight table and local learning
 * have no aircraft. Never apply a marketing carrier's prior to an unresolved
 * codeshare.
 */
export function inferFleetRouteEquipment(
  airline: string,
  origin?: string,
  dest?: string,
  operator?: string,
  flightMinutes?: number,
  month?: number,
  hasStarFlag = false
): FleetRouteGuess | undefined {
  const a = (origin || "").toUpperCase();
  const b = (dest || "").toUpperCase();
  if (!a || !b) return undefined;
  if (hasStarFlag && !operator) return undefined;
  const carrier = operator ? operatorCode(operator) : airline.toUpperCase();
  if (!carrier) return undefined; // unfamiliar operating carrier: do not guess
  const G = AIRPORT_GROUPS;
  const usDomestic = G.us.has(a) && G.us.has(b);
  const europe = G.europe;
  const india = G.india;
  const winter = month === 11 || month === 12 || month === 1 || month === 2 || month === 3;

  if (carrier === "BA") {
    if (between(a, b, new Set(["LHR"]), new Set(["CAI", "AMM", "TLV"]))) return guess("32N", ["32Q", "320"]);
    if (between(a, b, new Set(["LHR"]), G.gulf)) return guess("789", ["77W", "351"]);
    if (between(a, b, new Set(["LHR"]), india)) return guess("789", ["77W", "351"]);
    if (between(a, b, new Set(["LHR"]), G.longHaulAfrica)) return guess("77W", ["789", "388", "351"]);
    if (between(a, b, new Set(["LHR"]), G.asia)) return guess("789", ["77W", "351"]);
    if (between(a, b, new Set(["LHR"]), new Set(["CPT", "JNB", "NBO", "LOS"]))) return guess("77W", ["789", "388", "351"]);
    if (between(a, b, new Set(["LHR"]), new Set(["MIA", "BOS", "ORD", "LAX", "SFO", "JFK", "EWR", "IAD", "PHL", "ATL", "DFW", "IAH"]))) {
      if (winter && (a === "JFK" || b === "JFK")) return guess("772", ["77W", "789", "78X", "351"]);
      return guess("77W", ["789", "78X", "351"]);
    }
    if (between(a, b, new Set(["LHR"]), new Set(["SJU", "NAS", "MBJ", "PUJ", "SDQ", "AUA", "CUR", "SXM", "BGI", "GCM", "STT", "ANU", "UVF", "PTY", "BOG", "UIO", "GYE", "LIM", "SCL", "EZE", "GIG", "GRU"]))) return guess("77W", ["789", "772"]);
    if ((G.uk.has(a) && europe.has(b)) || (G.uk.has(b) && europe.has(a))) return guess("32N", ["32Q", "320", "321", "319"]);
  }

  if (carrier === "AA") {
    if (usDomestic && between(a, b, new Set(["JFK", "BOS", "MIA"]), new Set(["LAX", "SFO"]))) return guess("321", ["32Q", "320", "319"]);
    if (usDomestic && flightMinutes !== undefined && flightMinutes < 90) return guess("E75", ["CR9", "CR7", "319", "320"]);
    if (usDomestic) return guess("321", ["32Q", "320", "319", "738", "7M8"]);
    if (between(a, b, G.us, europe)) return guess("789", ["77W", "788", "772"]);
    if (between(a, b, G.us, G.caribbean) || between(a, b, G.us, G.mexico) || between(a, b, G.us, G.centralAmerica)) return guess("738", ["7M8", "321", "320", "319"]);
    if (between(a, b, G.us, G.southAmerica)) return guess("789", ["788", "77W", "772"]);
    if (between(a, b, G.us, G.asia) || between(a, b, G.us, G.australia)) return guess("789", ["77W", "788", "772"]);
  }

  if (carrier === "DL") {
    if (between(a, b, new Set(["JFK"]), new Set(["LAX", "SFO"]))) return guess("763", ["752", "321"]);
    if (between(a, b, G.us, new Set(["TLV"]))) return guess("339");
    if (usDomestic && flightMinutes !== undefined && flightMinutes < 90) return guess("E75", ["CR9", "CR7"]);
    if (between(a, b, G.us, europe)) return guess("333", ["332", "339", "359", "763", "764"]);
    if (between(a, b, G.us, G.asia)) return guess("359", ["339", "333"]);
    if (between(a, b, G.us, G.caribbean) || between(a, b, G.us, G.mexico)) return guess("738", ["739", "321", "320"]);
    if (between(a, b, G.us, G.southAmerica)) return guess("763", ["359", "339"]);
    if (between(a, b, G.us, G.africa)) return guess("332", ["359"]);
    if (usDomestic) return guess("738", ["739", "321", "32Q", "320", "319", "717", "223"]);
  }

  if (carrier === "UA") {
    if (between(a, b, new Set(["EWR"]), india)) return guess("789", ["788", "77W"]);
    if (between(a, b, new Set(["JFK", "EWR", "BOS", "MIA", "IAD"]), new Set(["LAX", "SFO"]))) return guess("752", ["753", "7M9"]);
    if (between(a, b, G.us, new Set(["TLV"]))) return guess("789");
    if (usDomestic && flightMinutes !== undefined && flightMinutes < 90) return guess("E75", ["CR7"]);
    if (between(a, b, G.us, europe)) return guess("763", ["764", "788", "789", "78X", "772", "752"]);
    if (between(a, b, G.us, G.asia)) return guess("789", ["78X", "77W", "772"]);
    if (between(a, b, G.us, G.caribbean) || between(a, b, G.us, G.mexico)) return guess("738", ["7M8", "7M9"]);
    if (between(a, b, G.us, G.southAmerica)) return guess("763", ["764", "789"]);
    if (usDomestic) return guess("738", ["739", "7M8", "7M9", "320", "319", "321", "32Q"]);
  }

  if (carrier === "B6") {
    if (between(a, b, G.us, europe)) return guess("321");
    if (usDomestic && between(a, b, new Set(["JFK", "BOS"]), new Set(["LAX", "SFO"]))) return guess("321");
    if (usDomestic) return guess("320", ["321", "223", "E90"]);
    if (between(a, b, G.us, G.caribbean)) return guess("320", ["321"]);
  }

  if (carrier === "AS" || carrier === "HA") {
    const hawaii = new Set(["HNL", "OGG", "KOA", "LIH"]);
    if (between(a, b, hawaii, new Set([...G.asia, ...G.australia]))) return guess("789", ["332", "333"]);
    if (between(a, b, hawaii, G.us)) return carrier === "HA" ? guess("332", ["333"]) : guess("7M9", ["738"]);
    if (usDomestic) return guess("738", ["7M9", "7M8"]);
  }

  if (carrier === "WN") return guess("73W", ["738", "7M8"]);

  if (carrier === "IB") {
    if (between(a, b, new Set(["MAD"]), new Set(["JFK", "EWR"]))) return guess("333", ["332", "359", "32Q"]);
    if (between(a, b, new Set(["MAD"]), G.us)) return guess("359", ["333", "332"]);
    if (between(a, b, new Set(["MAD"]), G.southAmerica)) return guess("359", ["333", "332"]);
    if ((a === "MAD" && europe.has(b)) || (b === "MAD" && europe.has(a))) return guess("320", ["32N", "321", "32Q", "319"]);
    if (between(a, b, new Set(["MAD"]), new Set(["AMM", "TLV"]))) return guess("320", ["32N", "321"]);
    if (between(a, b, new Set(["MAD"]), new Set(["CMN", "RAK", "TUN", "ALG", "CAI"]))) return guess("320", ["32N", "321"]);
  }

  if (carrier === "SV") {
    const saudi = new Set(["JED", "RUH", "DMM", "MED"]);
    if (between(a, b, G.us, new Set(["JED", "RUH"]))) return guess("77W", ["789"]);
    if (between(a, b, new Set(["JED", "RUH"]), new Set([...india, "KHI", "LHE", "ISB", "CAI"]))) return guess("333", ["332", "789"]);
    if (between(a, b, saudi, europe)) return guess("333", ["77W", "789", "320"]);
    if (between(a, b, saudi, G.asia)) return guess("77W", ["789", "333"]);
    if (saudi.has(a) && saudi.has(b)) return guess("320", ["32N", "321", "32Q"]);
  }

  if (carrier === "RJ") {
    if (between(a, b, new Set(["AMM"]), G.us)) return guess("788");
    if (between(a, b, new Set(["AMM"]), europe)) return guess("320", ["321", "319", "788"]);
    if (between(a, b, new Set(["AMM"]), new Set([...G.gulf, ...india, "BEY", "TLV", "CAI"]))) return guess("320", ["321", "788"]);
  }

  if (carrier === "LH") {
    if (between(a, b, G.us, new Set(["FRA", "MUC"]))) return guess("359", ["333", "346", "748", "789"]);
    if (between(a, b, new Set(["FRA", "MUC"]), india)) return guess("359", ["333", "346", "789"]);
    if (europe.has(a) && europe.has(b)) return guess("320", ["32N", "321", "319", "32Q"]);
  }

  if (carrier === "AF" || carrier === "KL") {
    const hub = carrier === "AF" ? new Set(["CDG", "ORY"]) : new Set(["AMS"]);
    if (between(a, b, G.us, hub)) return guess("77W", ["789", "359", "332"]);
    if (between(a, b, hub, india)) return guess("77W", ["789", "359"]);
    if (europe.has(a) && europe.has(b)) return guess("320", ["321", "319", ...(carrier === "AF" ? ["223"] : ["E90"])]);
  }

  if (carrier === "VS") {
    if (between(a, b, G.us, new Set(["LHR", "LGW"]))) return guess("359", ["339", "789"]);
    if (between(a, b, new Set(["LHR"]), india)) return guess("351", ["789"]);
  }

  if (carrier === "TK") {
    if (between(a, b, G.us, new Set(["IST"]))) return guess("77W", ["333", "359", "789"]);
    if (between(a, b, new Set(["IST"]), europe)) return guess("321", ["32Q", "320", "738"]);
    if (between(a, b, new Set(["IST"]), india) || between(a, b, new Set(["IST"]), G.africa)) return guess("333", ["321", "77W"]);
    if (between(a, b, new Set(["IST"]), G.asia)) return guess("77W", ["359", "333"]);
  }

  if (carrier === "EK") {
    if (between(a, b, G.us, new Set(["DXB"]))) return guess("77W", ["388"]);
    if (between(a, b, new Set(["DXB"]), india)) return guess("77W", ["388", "359"]);
    if (between(a, b, new Set(["DXB"]), europe)) return guess("388", ["77W"]);
    if (between(a, b, new Set(["DXB"]), G.africa) || between(a, b, new Set(["DXB"]), G.asia)) return guess("77W", ["388", "359"]);
  }

  if (carrier === "QR") {
    if (between(a, b, G.us, new Set(["DOH"]))) return guess("77W", ["789", "359", "351", "388"]);
    if (between(a, b, new Set(["DOH"]), india)) return guess("77W", ["359", "789", "351"]);
    if (between(a, b, new Set(["DOH"]), europe)) return guess("359", ["351", "789", "388"]);
    if (between(a, b, new Set(["DOH"]), G.africa) || between(a, b, new Set(["DOH"]), G.asia)) return guess("788", ["332", "359", "77W"]);
  }

  if (carrier === "EY") {
    if (between(a, b, G.us, new Set(["AUH"]))) return guess("789", ["78X", "388"]);
    if (between(a, b, new Set(["AUH"]), india)) return guess("789", ["77W", "332"]);
    if (between(a, b, new Set(["AUH"]), europe)) return guess("789", ["388", "77W"]);
  }

  if (carrier === "MS") {
    if (between(a, b, G.us, new Set(["CAI"]))) return guess("788", ["789", "333", "77W"]);
    if (between(a, b, new Set(["CAI"]), europe)) return guess("320", ["321", "32N", "738"]);
    if (between(a, b, new Set(["CAI"]), G.gulf) || between(a, b, new Set(["CAI"]), G.africa)) return guess("320", ["321", "738", "333", "789"]);
  }

  if (carrier === "AI") {
    if (between(a, b, G.us, india) || between(a, b, G.canada, india)) return guess("77W", ["788", "359", "789"]);
    if (between(a, b, india, europe)) return guess("788", ["77W", "359"]);
    if (india.has(a) && india.has(b)) return guess("320", ["32N", "321", "32Q", "738"]);
  }

  if (carrier === "AC") {
    if (between(a, b, G.canada, G.us)) return guess("320", ["321", "7M8", "E75", "E90", "CR9"]);
    if (between(a, b, G.canada, europe)) return guess("333", ["77W", "789", "788"]);
    if (between(a, b, G.canada, india) || between(a, b, G.canada, G.asia)) return guess("77W", ["789", "788"]);
  }

  if (carrier === "AM") {
    if (between(a, b, G.mexico, G.us)) return guess("738", ["7M8", "7M9", "E90"]);
    if (between(a, b, G.mexico, europe) || between(a, b, G.mexico, G.southAmerica) || between(a, b, G.mexico, G.asia)) return guess("788", ["789"]);
  }

  if (carrier === "CM") {
    if (between(a, b, new Set(["PTY"]), G.us) || between(a, b, new Set(["PTY"]), G.southAmerica) || between(a, b, new Set(["PTY"]), G.centralAmerica)) return guess("738", ["7M8", "7M9"]);
  }

  if (carrier === "LA" || carrier === "AV") {
    if (G.southAmerica.has(a) && G.southAmerica.has(b)) return guess("320", ["321", "32N", "32Q"]);
    if ((G.southAmerica.has(a) || G.centralAmerica.has(a) || G.mexico.has(a)) &&
      (G.southAmerica.has(b) || G.centralAmerica.has(b) || G.mexico.has(b))) return guess("320", ["321", "32N", "32Q"]);
    if (between(a, b, new Set([...G.southAmerica, ...G.centralAmerica, ...G.mexico]), new Set([...europe, ...G.us, ...G.asia]))) return guess("789", ["788", "77W"]);
  }
  return undefined;
}

/**
 * Infer aircraft by route when not specified in the source. The exact-flight
 * table is preferred; these route/fleet priors are approximate and can return
 * undefined, especially when a codeshare's operating carrier is unknown.
 */
export function inferRouteEquipment(
  airline: string,
  origin?: string,
  dest?: string,
  operator?: string,
  flightMinutes?: number,
  month?: number,
  hasStarFlag = false
): string | undefined {
  const resolvedOperator = operator ? operatorCode(operator) : undefined;
  if ((hasStarFlag || operator) && !resolvedOperator) return undefined;
  const op = (operator || "").toUpperCase();
  const al = (airline || "").toUpperCase();
  const orig = (origin || "").toUpperCase();
  const dst = (dest || "").toUpperCase();

  // Once a different operating carrier is known, never apply the marketing
  // carrier's legacy route heuristics. Use only that operator's fleet prior.
  if (operator && resolvedOperator !== al) {
    return inferFleetRouteEquipment(
      airline, origin, dest, operator, flightMinutes, month, hasStarFlag
    )?.equip;
  }

  // British Airways routes:
  // LHR-CPT is Boeing 787-8 (788)
  if (
    (op.includes("BRITISH") || al === "BA") &&
    ((orig === "LHR" && dst === "CPT") || (orig === "CPT" && dst === "LHR"))
  ) {
    return "788";
  }

  // JNB-LHR is Airbus A380-800 (388)
  if (
    (op.includes("BRITISH") || al === "BA") &&
    ((orig === "JNB" && dst === "LHR") || (orig === "LHR" && dst === "JNB"))
  ) {
    return "388";
  }

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

  const fleetPrior = inferFleetRouteEquipment(
    airline,
    origin,
    dest,
    operator,
    flightMinutes,
    month,
    hasStarFlag
  );
  return fleetPrior?.equip;
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

  // The user notes Iberia 78xx flights to/from Amman are operated by Royal
  // Jordanian. Use RJ's fleet prior downstream, not Iberia's marketing fleet.
  if (al === "IB" && /^78\d{2}$/.test(num) && (orig === "AMM" || dst === "AMM")) {
    return {
      airline: al,
      flightNumber: String(flightNumber),
      origin: orig,
      dest: dst,
      operator: "ROYAL JORDANIAN",
    };
  }

  return KNOWN_FLIGHTS.find((k) => {
    if (k.airline !== al) return false;
    if (k.flightNumber.replace(/^0+/, "").trim() !== num) return false;
    if (orig && k.origin && k.origin !== orig) return false;
    if (dst && k.dest && k.dest !== dst) return false;
    return true;
  });
}
