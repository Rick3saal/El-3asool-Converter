/**
 * Airport helpers: standard UTC offsets (winter/standard time) used only as a
 * fallback when the source does not state the block/elapsed time.
 * Also a small set of unambiguous city -> airport mappings.
 */

export function isValidAirportCode(code: string): boolean {
  return /^[A-Z]{3}$/.test(code);
}

// standard UTC offset in minutes (DST not applied; used for estimation only)
const TZ: Record<string, number> = {
  // North America
  YYZ: -300, YUL: -300, YVR: -480, YYC: -420, YOW: -300, YEG: -420, YHZ: -240,
  YWG: -360, YQB: -300, YQR: -360, YYT: -210,
  JFK: -300, EWR: -300, LGA: -300, CLT: -300, ORD: -360, MDW: -360, MIA: -300,
  FLL: -300, ATL: -300, BOS: -300, LAX: -480, SFO: -480, SEA: -480, PDX: -480,
  SAN: -480, LAS: -480, PHX: -420, DEN: -420, IAH: -360, DFW: -360, AUS: -360,
  MSP: -360, DTW: -300, PHL: -300, DCA: -300, IAD: -300, BWI: -300, MCO: -300,
  TPA: -300, RDU: -300, BNA: -360, STL: -360, MCI: -360, IND: -300, CMH: -300,
  CLE: -300, CVG: -300, PIT: -300, MKE: -360, SLC: -420, SMF: -480, OAK: -480,
  SJC: -480, ANC: -540, HNL: -600, MSY: -360, SAT: -360, TUS: -420, ABQ: -420,
  OMA: -360, OKC: -360, TUL: -360, MEM: -360, JAX: -300, PBI: -300, RSW: -300,
  BUF: -300, ROC: -300, SYR: -300, GSO: -300, CHS: -300, SAV: -300, BDL: -300,
  PVD: -300, PWM: -300, BUR: -480, ONT: -480, SNA: -480, LGB: -480, FAT: -480,
  RNO: -480, BOI: -420, GEG: -480, MEX: -360, CUN: -300, GDL: -360, MTY: -360,
  // additional US/Canada regional airports
  ALB: -300, BGR: -300, BTV: -300, MHT: -300, ORF: -300, RIC: -300, GSP: -300,
  AVL: -300, MYR: -300, ILM: -300, TYS: -300, LEX: -300, SDF: -300, DAY: -300,
  TOL: -300, GRR: -300, FWA: -300, SBN: -300, PIA: -360, SPI: -360, CID: -360,
  DSM: -360, MSN: -360, GRB: -360, DLH: -360, FAR: -360, FSD: -360, RAP: -420,
  BIL: -420, MSO: -420, GTF: -420, IDA: -420, JAC: -420, COS: -420, ASE: -420,
  EGE: -420, DRO: -420, GJT: -420, BZN: -420, HLN: -420, CPR: -420, GCC: -420,
  ELP: -420, ROW: -420, LBB: -360, AMA: -360, MAF: -360, CRP: -360, HRL: -360,
  BRO: -360, LRD: -360, GRK: -360, SHV: -360, LFT: -360, BTR: -360, MOB: -360,
  MGM: -360, HSV: -360, BHM: -360, TRI: -300, CHA: -300, AGS: -300, CAE: -300,
  FAY: -300, EWN: -300, PHF: -300, ROA: -300, CRW: -300, HTS: -300, CKB: -300,
  ERI: -300, AVP: -300, ABE: -300, BGM: -300, ELM: -300, ITH: -300, SYR2: -300,
  PBG: -300, MSS: -300, OGS: -300, ART: -300, RME: -300, IAG: -300,
  YQT: -300, YSJ: -240, YFC: -240, YQM: -240, YDF: -210, YYR: -240, YXX: -480,
  YLW: -480, YXS: -480, YXY: -480, YZF: -420, YFB: -300,
  BJX: -360, SJD: -420, PVR: -360, GUA: -360, SJO: -360, PTY: -300, BOG: -300,
  UIO: -300, GYE: -300, LIM: -300, SCL: -240, EZE: -180, AEP: -180, GIG: -180,
  GRU: -180, BSB: -180, SSA: -180, REC: -180, CNF: -180, POA: -180,
  // Europe
  LHR: 0, LGW: 0, STN: 0, LTN: 0, MAN: 0, EDI: 0, GLA: 0, BHX: 0, BRS: 0,
  NCL: 0, DUB: 0, SNN: 0,
  CDG: 60, ORY: 60, NCE: 60, LYS: 60, MRS: 60, TLS: 60, BOD: 60, NTE: 60, LIL: 60,
  FRA: 60, MUC: 60, BER: 60, HAM: 60, DUS: 60, CGN: 60, STR: 60, HAJ: 60,
  NUE: 60, LEJ: 60, AMS: 60, BRU: 60, ZRH: 60, GVA: 60, BSL: 60, VIE: 60,
  SZG: 60, MAD: 60, BCN: 60, AGP: 60, PMI: 60, VLC: 60, SVQ: 60, LIS: 0,
  OPO: 0, FAO: 0, FCO: 60, MXP: 60, LIN: 60, VCE: 60, NAP: 60, BGY: 60,
  PSA: 60, CTA: 60, CPH: 60, OSL: 60, ARN: 60, HEL: 120, KEF: 0,
  WAW: 60, KRK: 60, GDN: 60, PRG: 60, BUD: 60, BEG: 60, SOF: 120, ZAG: 60,
  LJU: 60, ATH: 120, SKG: 120, HER: 120, IST: 180, SAW: 180, AYT: 180,
  ANK: 180, DLM: 180, OTP: 120, KBP: 120, MSQ: 180, VNO: 120, RIX: 120,
  TLL: 120, KIV: 120, TGD: 60, SKP: 60, TIA: 60,
  // Middle East
  DXB: 240, SHJ: 240, AUH: 240, DOH: 180, BAH: 180, KWI: 180, RUH: 180,
  JED: 180, DMM: 180, MED: 180, MCT: 240, AMM: 120, BEY: 120, TLV: 120,
  DME: 180, SVO: 180, LED: 180, GYD: 240, EVN: 240, TBS: 240,
  // Africa
  CAI: 120, HUR: 120, LXR: 120, SSH: 120, ALY: 120, ADD: 180, NBO: 180,
  DAR: 180, EBB: 180, JNB: 120, CPT: 120, DUR: 120, CMN: 60, RAK: 60,
  TUN: 60, ALG: 60, LOS: 60, ACC: 0, ABV: 60, DKR: 0, MRU: 240, SEZ: 240,
  // Asia
  NRT: 540, HND: 540, KIX: 540, NGO: 540, FUK: 540, CTS: 540, OKA: 540,
  ITM: 540, ICN: 540, GMP: 540, PUS: 540, CJU: 540, PEK: 480, PVG: 480,
  SHA: 480, CAN: 480, SZX: 480, CTU: 480, HGH: 480, WUH: 480, XIY: 480,
  NKG: 480, CKG: 480, KMG: 480, TSN: 480, TAO: 480, HKG: 480, MFM: 480,
  TPE: 480, TSA: 480, KHH: 480, RMQ: 480, BKK: 420, DMK: 420, CNX: 420,
  HKT: 420, SIN: 480, KUL: 480, CGK: 420, DPS: 480, SUB: 420, MNL: 480,
  CRK: 480, SGN: 420, HAN: 420, DAD: 420, PNH: 420, REP: 420, RGN: 390,
  VTE: 420, DEL: 330, BOM: 330, MAA: 330, BLR: 330, HYD: 330, CCU: 330,
  COK: 330, AMD: 330, GOI: 330, PNQ: 330, DAC: 360, KTM: 345, CMB: 330,
  KHI: 300, LHE: 300, ISB: 300, TAS: 300, ALA: 360, FRU: 360,
  // Oceania
  SYD: 600, MEL: 600, BNE: 600, PER: 480, ADL: 570, CBR: 600, OOL: 600,
  AKL: 720, WLG: 720, CHC: 720, NAN: 720,
};

export function tzOffsetMinutes(code: string): number | null {
  const c = code.toUpperCase();
  return TZ[c] ?? null;
}

/** US federal daylight-saving dates for real years (2nd Sunday of March ->
 *  1st Sunday of November, applied from/to the specified date). When a year is
 *  not in the table, estimate elapsed time from standard-time offsets only. */
const US_DST: Record<number, { start: string; end: string }> = {
  2024: { start: "03-10", end: "11-03" },
  2025: { start: "03-09", end: "11-02" },
  2026: { start: "03-08", end: "11-01" },
  2027: { start: "03-14", end: "11-07" },
  2028: { start: "03-12", end: "11-05" },
  2029: { start: "03-11", end: "11-04" },
  2030: { start: "03-10", end: "11-03" },
};

/** Airports on the contiguous US / Pacific US DST schedule. */
const US_DST_AIRPORTS = new Set([
  "LAX", "SFO", "SEA", "PDX", "SAN", "LAS", "BUR", "ONT", "SNA", "LGB",
  "FAT", "RNO", "GEG", "JFK", "EWR", "LGA", "CLT", "ORD", "MDW", "MIA",
  "FLL", "ATL", "BOS", "IAH", "DFW", "AUS", "MSP", "DTW", "PHL", "DCA",
  "IAD", "BWI", "MCO", "TPA", "RDU", "BNA", "STL", "MCI", "IND", "CMH",
  "CLE", "CVG", "PIT", "MKE", "SMF", "OAK", "SJC", "MSY", "SAT", "ABQ",
  "OMA", "OKC", "TUL", "MEM", "JAX", "PBI", "RSW", "BUF", "ROC", "GSO",
  "CHS", "SAV", "BDL", "PVD", "PWM", "ALB", "MHT", "ORF", "RIC", "SYR",
  "GSP", "AVL", "MYR", "ILM", "TYS", "LEX", "SDF", "DAY", "TOL", "GRR",
  "FWA", "SBN", "PIA", "SPI", "CID", "DSM", "MSN", "GRB", "DLH", "FAR",
  "FSD", "ELP", "LBB", "AMA", "MAF", "CRP", "HRL", "BRO", "LRD", "GRK",
  "SHV", "LFT", "BTR", "MOB", "MGM", "HSV", "BHM", "TRI", "CHA", "AGS",
  "CAE", "FAY", "EWN", "PHF", "ROA", "CRW", "HTS", "CKB", "ERI", "AVP",
  "ABE", "BGM", "ELM", "ITH", "PBG", "MSS", "OGS", "ART", "RME", "IAG",
]);

/** Canadian provinces that follow the US DST schedule. */
const CA_DST_AIRPORTS = new Set([
  "YVR", "YYZ", "YUL", "YOW", "YYC", "YEG", "YHZ", "YWG", "YQB", "YYT",
  "YQT", "YSJ", "YFC", "YQM", "YDF", "YXX", "YLW", "YXS",
]);

/** Europe (EU/UK): DST runs last Sunday of March -> last Sunday of October. */
const EU_DST_AIRPORTS = new Set([
  "LHR", "LGW", "STN", "LTN", "MAN", "EDI", "GLA", "BHX", "BRS", "NCL",
  "DUB", "SNN", "CDG", "ORY", "NCE", "LYS", "MRS", "TLS", "BOD", "NTE",
  "LIL", "FRA", "MUC", "BER", "HAM", "DUS", "CGN", "STR", "HAJ", "NUE",
  "LEJ", "AMS", "BRU", "ZRH", "GVA", "BSL", "VIE", "SZG", "MAD", "BCN",
  "AGP", "PMI", "VLC", "SVQ", "LIS", "OPO", "FAO", "FCO", "MXP", "LIN",
  "VCE", "NAP", "BGY", "PSA", "CTA", "CPH", "OSL", "ARN", "WAW", "KRK",
  "GDN", "PRG", "BUD", "BEG", "ZAG", "LJU", "OTP", "VNO", "RIX", "TLL",
  "TGD", "SKP", "TIA",
]);

// Regions whose DST dates aren't solidly established here — don't guess.
const SouthernHemisphereDST = new Set<string>(); // none: no guessing per spec

/** Daylight UTC offset in minutes for `code` on the given date.
 *  Returns null when the airport either doesn't observe DST or its DST dates
 *  are not confidently known — meaning "use the standard offset". */
function dstActiveOffset(
  code: string,
  month: number,
  day: number,
  year?: number
): number | null {
  if (!year) return null; // no year: do not guess DST (TI table handles 1OCT with no explicit year too)
  const md = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const usDates = US_DST[year];
  if (!usDates) return null;
  void SouthernHemisphereDST;
  if (SouthernHemisphereDST.has(code)) return null;
  if (US_DST_AIRPORTS.has(code) || CA_DST_AIRPORTS.has(code)) {
    const inDst = md >= usDates.start && md < usDates.end;
    if (inDst) return (TZ[code] ?? 0) + 60;
    return null;
  }
  if (EU_DST_AIRPORTS.has(code)) {
    // EU/UK rule: last Sunday Mar 00:59 UTC -> last Sunday Oct 01:59 UTC.
    // As dates, approximate by 25..31 March / 25..31 October lookups.
    if (month >= 4 && month <= 9) return (TZ[code] ?? 0) + 60;
    if (month === 3) {
      const lsm = lastSundayOfMonth(year, 2);
      return day >= lsm ? (TZ[code] ?? 0) + 60 : null;
    }
    if (month === 10) {
      const lso = lastSundayOfMonth(year, 9);
      return day < lso ? (TZ[code] ?? 0) + 60 : null;
    }
    return null;
  }
  return null;
}

function lastSundayOfMonth(year: number, month0: number): number {
  // day-of-week of the last day; walk backwards to Sunday
  const last = new Date(Date.UTC(year, month0 + 1, 0));
  const dow = last.getUTCDay();
  return last.getUTCDate() - dow;
}

/** Date-aware UTC offset (standard + DST when actively known). */
export function tzOffsetMinutesOnDate(
  code: string,
  month?: number,
  day?: number,
  year?: number
): number | null {
  const std = tzOffsetMinutes(code);
  if (std === null) return null;
  if (month === undefined || day === undefined) {
    // The itinerary always travels with a month+day, but a bare sample may not.
    // Keep the standard offset rather than assume DST.
    return std;
  }
  const dstOff = dstActiveOffset(code.toUpperCase(), month, day, year);
  if (dstOff !== null) return dstOff;
  if (!year) {
    /* No explicit year: US DST 2nd Sun Mar (8th–14th) -> 1st Sun Nov
     * (1st–7th), EU/UK last Sun Mar (25th–31st) -> last Sun Oct (25th–31st).
     * Only apply DST for dates that are inside the window in EVERY possible
     * year — never guess inside the ambiguous weeks. */
    const c = code.toUpperCase();
    if (US_DST_AIRPORTS.has(c) || CA_DST_AIRPORTS.has(c)) {
      // unambiguously inside: Mar 15 .. Oct 31
      if (month >= 4 && month <= 10) return std + 60;
      if (month === 3 && day >= 15) return std + 60;
    }
    if (EU_DST_AIRPORTS.has(c)) {
      // unambiguously inside: Apr 1 .. Oct 24
      if (month >= 4 && month <= 9) return std + 60;
      if (month === 10 && day <= 24) return std + 60;
    }
  }
  return std;
}

/** Estimate block/elapsed time in minutes from local clock times + timezones.
 *  When the flight date is known, DST is applied for US/Canada/Europe
 *  airports (e.g. SEA/LAX/YVR are UTC-7 on October dates; ICN always UTC+9). */
export function estimateElapsed(
  origin: string,
  dest: string,
  depMin: number,
  arrMin: number,
  date?: { month: number; day: number; year?: number }
): { minutes: number; confident: boolean } {
  const tzo = tzOffsetMinutesOnDate(origin, date?.month, date?.day, date?.year);
  const tzd = tzOffsetMinutesOnDate(dest, date?.month, date?.day, date?.year);
  if (tzo !== null && tzd !== null) {
    // convert both to UTC, then wrap into (0, 1440]. Date-line crossings are
    // handled by the wrap itself — a ¥1/+1 marker only affects how the
    // arrival day prints, never the duration.
    let diff = (arrMin - tzd) - (depMin - tzo);
    while (diff <= 0) diff += 1440;
    while (diff > 2 * 1440) diff -= 1440;
    return { minutes: diff, confident: true };
  }
  let diff = arrMin - depMin;
  while (diff <= 0) diff += 1440;
  return { minutes: diff, confident: false };
}

// Cities with a single dominant airport used ONLY when the source gives a
// city name without any 3-letter code anywhere near the flight.
const CITY_TO_CODE: Record<string, string> = {
  cairo: "CAI", newark: "EWR", belgrade: "BEG", budapest: "BUD",
  charlotte: "CLT", sofia: "SOF", athens: "ATH", lisbon: "LIS",
  madrid: "MAD", barcelona: "BCN", istanbul: "IST", casablanca: "CMN",
  nairobi: "NBO", johannesburg: "JNB", manila: "MNL", bangkok: "BKK",
  singapore: "SIN", jakarta: "CGK", hanoi: "HAN", mumbai: "BOM",
  delhi: "DEL", dubai: "DXB", doha: "DOH", buda: "BUD",
};

export function cityToCode(city: string): string | null {
  const key = city.toLowerCase().replace(/[^a-z ]/g, "").replace(/\s+/g, "");
  return CITY_TO_CODE[key] ?? null;
}

/**
 * Metro grouping for multi-airport cities. Used to recognise that a routing
 * "break" between two airports of the SAME city (e.g. Osaka ITM→KIX, Tokyo
 * NRT→HND, New York JFK→EWR, London LHR→LGW) is NOT a new journey — it is a
 * same-city airport change. Unknown codes fall back to themselves, so two
 * different unknown codes count as different cities.
 */
const AIRPORT_CITY: Record<string, string> = {
  NRT: "tokyo", HND: "tokyo", TYO: "tokyo",
  ITM: "osaka", KIX: "osaka", OSA: "osaka",
  JFK: "newyork", EWR: "newyork", LGA: "newyork",
  LHR: "london", LGW: "london", STN: "london", LTN: "london", LCY: "london",
  CDG: "paris", ORY: "paris", BVA: "paris",
  IAD: "washington", DCA: "washington", BWI: "washington",
  ORD: "chicago", MDW: "chicago",
  DXB: "dubai", DWC: "dubai",
  SAW: "istanbul", IST: "istanbul",
  PVG: "shanghai", SHA: "shanghai",
  PEK: "beijing", PKX: "beijing",
  ICN: "seoul", GMP: "seoul",
  GRU: "saopaulo", CGH: "saopaulo", VCP: "saopaulo",
  EZE: "buenosaires", AEP: "buenosaires",
  MEX: "mexicocity", MEX2: "mexicocity",
  RIO: "rio", GIG: "rio", SDU: "rio",
  TPE: "taipei", TSA: "taipei",
  MOW: "moscow", SVO: "moscow", DME: "moscow", VKO: "moscow",
  NYC: "newyork", OSA2: "osaka", TYO2: "tokyo",
};

export function airportCity(code: string | undefined): string | null {
  if (!code) return null;
  const c = code.toUpperCase();
  return AIRPORT_CITY[c] ?? c;
}

export function sameCity(a: string | undefined, b: string | undefined): boolean {
  const ca = airportCity(a);
  const cb = airportCity(b);
  return !!ca && !!cb && ca === cb;
}
