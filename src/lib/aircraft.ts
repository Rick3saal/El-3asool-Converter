/**
 * Aircraft -> Sabre equipment mapping.
 * Aircraft descriptions are SUPPORTING information only. They must NEVER
 * create a flight segment (no BO 777, no EM 175, no AT 72 phantom carriers).
 *
 * Primary source of truth: user-supplied aircraft in the flight itinerary data.
 * Always extract and convert supplied aircraft types to the concise Sabre code.
 */

export interface AircraftToken {
  equip: string | null; // sabre equipment or null when unrecognized
  text: string; // original text e.g. "Boeing 737 MAX 9 Passenger"
  start: number;
  end: number;
}

/**
 * Direct explicit parsing for aircraft strings found in user input.
 * Handles all canonical forms:
 *   Boeing 737 MAX 9 Passenger -> 7M9
 *   Boeing 737 MAX 8 Passenger -> 7M8
 *   Boeing 737 -> 73H
 *   Boeing 777 -> 777
 *   Boeing 787 -> 787
 *   Boeing 767 -> 767
 *   Boeing A350 -> 350
 *   Airbus A350 -> 350
 *   Airbus A380 -> 380
 *   Airbus A321 -> 321
 *   Airbus A321neo -> 32N
 *   Airbus A320 -> 320
 *   Airbus A220-300 Passenger -> 220
 *   Embraer 175 -> 175 (E75 on Air Canada)
 *   Embraer 170 -> 170 (E70 on Air Canada)
 *   Canadair RJ 900 -> 900
 *   Bombardier Regional Jet 550 -> 550
 */
export function parseExplicitAircraftString(raw: string, airline?: string): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s || s === "---") return null;

  // 1. Boeing 737 MAX series (with or without "Passenger"/"Pax")
  if (/Boeing\s*737\s*MAX\s*9|\b737\s*MAX\s*9|\b737\s*-\s*9\s*MAX\b/i.test(s)) return "7M9";
  if (/Boeing\s*737\s*MAX\s*8|\b737\s*MAX\s*8|\b737\s*-\s*8\s*MAX\b/i.test(s)) return "7M8";
  if (/Boeing\s*737\s*MAX\s*7|\b737\s*MAX\s*7|\b737\s*-\s*7\s*MAX\b/i.test(s)) return "7M7";
  if (/Boeing\s*737\s*MAX\s*10|\b737\s*MAX\s*10|\b737\s*-\s*10\s*MAX\b/i.test(s)) return "7MJ";

  // 2. Boeing 737 variants
  if (/Boeing\s*737|\bB737\b|\b737\b/i.test(s)) {
    if (/737\s*-\s*800|\b738\b/i.test(s)) return "738";
    if (/737\s*-\s*900|\b739\b/i.test(s)) return "739";
    if (/737\s*-\s*700|\b73G\b/i.test(s)) return "73G";
    return "73H";
  }

  // 3. Boeing 777
  if (/Boeing\s*777|\bB777\b|\b777\b/i.test(s)) {
    if (/300\s*ER|\b77W\b/i.test(s)) return "77W";
    if (/200\s*LR|\b77L\b/i.test(s)) return "77L";
    if (/200\s*ER|200\b|\b772\b/i.test(s)) return "772";
    if (/300\b|\b773\b/i.test(s)) return "773";
    if (/777\s*-\s*8|\b778\b/i.test(s)) return "778";
    if (/777\s*-\s*9|\b779\b/i.test(s)) return "779";
    return "777";
  }

  // 4. Boeing 787
  if (/Boeing\s*787|\bB787\b|\b787\b/i.test(s)) {
    if (/787\s*-\s*9|\b789\b/i.test(s)) return "789";
    if (/787\s*-\s*8|\b788\b/i.test(s)) return "788";
    if (/787\s*-\s*10|\b78J\b/i.test(s)) return "78J";
    return "787";
  }

  // 5. Boeing 767
  if (/Boeing\s*767|\bB767\b|\b767\b/i.test(s)) {
    if (/767\s*-\s*300|\b763\b/i.test(s)) return "763";
    if (/767\s*-\s*400|\b764\b/i.test(s)) return "764";
    if (/767\s*-\s*200|\b762\b/i.test(s)) return "762";
    return "767";
  }

  // 6. Boeing 757
  if (/Boeing\s*757|\bB757\b|\b757\b/i.test(s)) {
    if (/757\s*-\s*200|\b752\b/i.test(s)) return "752";
    if (/757\s*-\s*300|\b753\b/i.test(s)) return "753";
    return "757";
  }

  // 7. Boeing 747
  if (/Boeing\s*747|\bB747\b|\b747\b/i.test(s)) {
    if (/747\s*-\s*400|\b744\b/i.test(s)) return "744";
    if (/747\s*-\s*8|\b748\b/i.test(s)) return "748";
    return "744";
  }

  // 8. Boeing 717
  if (/Boeing\s*717|\bB717\b|\b717\b/i.test(s)) return "717";

  // 9. Boeing A350 (unusual user input format) -> 350
  if (/Boeing\s+A\s*350/i.test(s)) return "350";

  // 10. Airbus A350
  if (/Airbus\s*A\s*350|\bA\s*350\b/i.test(s)) {
    if (/900/i.test(s)) return "359";
    if (/1000/i.test(s)) return "351";
    return "350";
  }

  // 11. Airbus A380
  if (/Airbus\s*A\s*380|\bA\s*380\b/i.test(s)) return "380";

  // 12. Airbus A321
  if (/Airbus\s*A\s*321|\bA\s*321\b/i.test(s)) {
    if (/neo\b/i.test(s)) return "32N";
    return "321";
  }

  // 13. Airbus A320
  if (/Airbus\s*A\s*320|\bA\s*320\b/i.test(s)) {
    if (/neo\b/i.test(s)) return "32N";
    return "320";
  }

  // 14. Airbus A319 / A318
  if (/Airbus\s*A\s*319|\bA\s*319\b/i.test(s)) return "319";
  if (/Airbus\s*A\s*318|\bA\s*318\b/i.test(s)) return "318";

  // 15. Airbus A330
  if (/Airbus\s*A\s*330|\bA\s*330\b/i.test(s)) {
    if (/300/i.test(s)) return "333";
    if (/200/i.test(s)) return "332";
    if (/800/i.test(s)) return "338";
    if (/900/i.test(s)) return "339";
    return "330";
  }

  // 16. Airbus A220
  if (/Airbus\s*A\s*220|\bA\s*220\b/i.test(s)) {
    if (/passenger|pax/i.test(s)) return "220";
    if (/300/i.test(s)) return "223";
    if (/100/i.test(s)) return "221";
    return "220";
  }

  // 17. Airbus A340
  if (/Airbus\s*A\s*340|\bA\s*340\b/i.test(s)) {
    if (/300/i.test(s)) return "343";
    if (/500/i.test(s)) return "345";
    if (/600/i.test(s)) return "346";
    return "343";
  }

  // 18. Embraer ERJ family (ERJ-145 / ERJ 140 / ERJ135 / EMB-145)
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*145\b/i.test(s)) return "145";
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*140\b/i.test(s)) return "140";
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*135\b/i.test(s)) return "135";
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*190\b/i.test(s)) return "E90";
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*195\b/i.test(s)) return "E95";
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*175\b/i.test(s)) return airline === "AC" ? "E75" : "175";
  if (/\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*170\b/i.test(s)) return airline === "AC" ? "E70" : "170";

  // 18b. Embraer E-Jet family
  if (/Embraer\s*(?:Regional\s*Jet\s*|E\s*)?175|\bE\s*175\b/i.test(s)) {
    return airline === "AC" ? "E75" : "175";
  }
  if (/Embraer\s*(?:Regional\s*Jet\s*|E\s*)?170|\bE\s*170\b/i.test(s)) {
    return airline === "AC" ? "E70" : "170";
  }
  if (/Embraer\s*(?:E\s*)?190|\bE\s*190\b/i.test(s)) return "E90";
  if (/Embraer\s*(?:E\s*)?195|\bE\s*195\b/i.test(s)) return "E95";
  if (/Embraer\s*(?:E\s*)?145|\bE\s*145\b/i.test(s)) return "145";

  // 19. Canadair / Bombardier / Regional Jet / CRJ
  if (/(?:Canadair|Bombardier)\s*RJ\s*-?\s*900|Regional\s*Jet\s*[- ]?900|\bCRJ\s*-?\s*900/i.test(s)) return "900";
  if (/(?:Canadair|Bombardier)\s*Regional\s*Jet\s*[- ]?550|RJ\s*-?\s*550|\bCRJ\s*-?\s*550/i.test(s)) return "550";
  if (/\bCRJ\s*-?\s*700/i.test(s)) return "CR7";
  if (/\bCRJ\s*-?\s*200/i.test(s)) return "CR2";
  if (/\bCRJ\s*-?\s*1000/i.test(s)) return "CRK";

  // 20. Turboprops: ATR, Q400 / Dash 8
  if (/\bATR\s*-?\s*72\b/i.test(s)) return "ATR";
  if (/\bATR\s*-?\s*42\b/i.test(s)) return "AT7";
  if (/\bQ\s*400|Dash\s*8/i.test(s)) return "DH4";

  return null;
}

export function mapAircraft(family: string, series?: string, extra?: string, airline?: string): string | null {
  const fam = family.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ser = (series || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const ext = (extra || "").toUpperCase().replace(/[^A-Z]/g, "");

  // Check Boeing
  if (fam === "BOEING" || fam.startsWith("BOEING")) {
    if (ser.includes("MAX9") || ser.includes("737MAX9") || (ser.includes("737") && ser.includes("9") && (ser.includes("MAX") || ext.includes("MAX")))) return "7M9";
    if (ser.includes("MAX8") || ser.includes("737MAX8") || (ser.includes("737") && ser.includes("8") && (ser.includes("MAX") || ext.includes("MAX")))) return "7M8";
    if (ser.includes("MAX7") || ser.includes("737MAX7") || (ser.includes("737") && ser.includes("7") && (ser.includes("MAX") || ext.includes("MAX")))) return "7M7";
    if (ser.includes("MAX10") || ser.includes("737MAX10") || (ser.includes("737") && ser.includes("10") && (ser.includes("MAX") || ext.includes("MAX")))) return "7MJ";
    if (fam.includes("A350") || fam.includes("350") || ser.includes("350") || ser.includes("A350")) return "350";

    switch (ser) {
      case "737": return "73H";
      case "737700": return "73G";
      case "737800": return "738";
      case "737900": return "739";
      case "747": return "744";
      case "747400": return "744";
      case "747800": return "748";
      case "757": return "757";
      case "757200": return "752";
      case "757300": return "753";
      case "767": return "767";
      case "767200": return "762";
      case "767300": return "763";
      case "767400": return "764";
      case "777": return "777";
      case "777200": return ext === "LR" ? "77L" : "772";
      case "777300": return ext === "ER" ? "77W" : "773";
      case "7778": return "778";
      case "7779": return "779";
      case "787": return "787";
      case "7878": return "788";
      case "7879": return "789";
      case "78710": return "78J";
      default: {
        if (fam.includes("737")) return "73H";
        if (fam.includes("777")) return "777";
        if (fam.includes("787")) return "787";
        if (fam.includes("767")) return "767";
        if (fam.includes("757")) return "757";
        if (fam.includes("747")) return "744";
        return null;
      }
    }
  }

  // Check Airbus
  if (fam === "AIRBUS" || fam.startsWith("A")) {
    const num = fam.startsWith("A") ? fam.replace(/^A/, "") : ser.replace(/^A/, "");
    if (num.startsWith("220") || ser.includes("220")) {
      if (ext.includes("PASSENGER") || ser.includes("PASSENGER")) return "220";
      if (ser.includes("300")) return "223";
      if (ser.includes("100")) return "221";
      return "220";
    }
    if (num.startsWith("350") || ser.includes("350")) {
      if (ser.includes("900")) return "359";
      if (ser.includes("1000")) return "351";
      return "350";
    }
    if (num.startsWith("380") || ser.includes("380")) return "380";
    if (num.startsWith("321") || ser.includes("321")) {
      return (ext.includes("NEO") || ser.includes("NEO")) ? "32N" : "321";
    }
    if (num.startsWith("320") || ser.includes("320")) {
      return (ext.includes("NEO") || ser.includes("NEO")) ? "32N" : "320";
    }
    if (num.startsWith("319") || ser.includes("319")) return "319";
    if (num.startsWith("318") || ser.includes("318")) return "318";
    if (num.startsWith("330") || ser.includes("330")) {
      if (ser.includes("300")) return "333";
      if (ser.includes("200")) return "332";
      if (ser.includes("800")) return "338";
      if (ser.includes("900")) return "339";
      return "330";
    }
    if (num.startsWith("340") || ser.includes("340")) {
      if (ser.includes("300")) return "343";
      if (ser.includes("500")) return "345";
      if (ser.includes("600")) return "346";
      return "343";
    }
  }

  // Check Embraer
  if (fam === "EMBRAER" || fam.startsWith("E")) {
    if (ser.includes("175") || fam === "E175") {
      return airline === "AC" ? "E75" : "175";
    }
    if (ser.includes("170") || fam === "E170") {
      return airline === "AC" ? "E70" : "170";
    }
    if (ser.includes("190") || fam === "E190") return "E90";
    if (ser.includes("195") || fam === "E195") return "E95";
  }

  if (fam === "ATR") return "ATR";

  // Check Canadair / Bombardier / Regional Jet / CRJ
  if (fam === "CRJ" || fam === "CANADAIR" || fam === "BOMBARDIER" || fam.includes("REGIONALJET")) {
    if (ser.includes("550")) return "550";
    if (ser.includes("900")) return "900";
    if (ser.includes("700")) return "CR7";
    if (ser.includes("200")) return "CR2";
    if (ser.includes("1000")) return "CRK";
    return "CRJ";
  }

  if (fam === "Q" || fam === "DASH" || fam === "DASH8") {
    switch (ser) {
      case "100": return "DH1";
      case "300": return "DH3";
      case "400": return "DH4";
      default: return "DH4";
    }
  }

  if (fam === "BOEING717") return "717";
  return null;
}

export function findAircraftTokens(text: string): AircraftToken[] {
  const tokens: AircraftToken[] = [];
  const push = (equip: string | null, raw: string, start: number, end: number) => {
    // If an existing token overlaps with this one, keep the longer / more specific one
    const existingIdx = tokens.findIndex((t) => Math.max(t.start, start) < Math.min(t.end, end));
    if (existingIdx !== -1) {
      const existing = tokens[existingIdx];
      if (end - start > existing.end - existing.start && equip) {
        tokens[existingIdx] = { equip, text: raw, start, end };
      }
      return;
    }
    tokens.push({ equip, text: raw, start, end });
  };

  // 1. Labelled lines: "Aircraft: ...", "Equipment: ...", "Plane: ..."
  const labelled = /\b(?:aircraft|equipment|plane)\s*[:：-]\s*([^\n,·|()]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = labelled.exec(text)) !== null) {
    const rawVal = m[1].trim();
    const mapped = parseExplicitAircraftString(rawVal);
    if (mapped) {
      push(mapped, m[0], m.index, m.index + m[0].length);
    }
  }

  // 2. Boeing 737 MAX with optional Passenger
  const boeingMax = /\bBoeing\s*(?:737\s*)?MAX\s*(\d{1,2})(?:\s+(?:Passenger|Pax))?/gi;
  while ((m = boeingMax.exec(text)) !== null) {
    const equip = mapAircraft("Boeing", `737MAX${m[1]}`);
    push(equip, m[0], m.index, m.index + m[0].length);
  }

  // 3. Boeing 777-300ER / 787-9 Dreamliner / 737 MAX 8 / 767-300 / 737-800
  const boeing = /\bBoeing\s*(\d{3})(?:\s*-\s*(\d{1,4})([A-Za-z]{0,3}))?(?:\s+(?:MAX|NG)\s*(\d+))?(?:\s+(?:Passenger|Pax))?/gi;
  boeing.lastIndex = 0;
  while ((m = boeing.exec(text)) !== null) {
    const fam = m[1];
    const ser = m[2];
    const ext = m[3];
    const maxModel = m[4];
    const pax = m[5];
    let equip: string | null = null;
    if (maxModel) {
      equip = mapAircraft("Boeing", `737MAX${maxModel}`, pax ? "PASSENGER" : "");
    } else if (ser) {
      equip = mapAircraft("Boeing", fam + ser, ext || (pax ? "PASSENGER" : ""));
      if (!equip) equip = mapAircraft("Boeing", fam, ext || (pax ? "PASSENGER" : ""));
    } else {
      equip = mapAircraft("Boeing", fam, ext || (pax ? "PASSENGER" : ""));
    }
    push(equip, m[0], m.index, m.index + m[0].length);
  }

  // 4. Boeing A350
  const boeingA = /\bBoeing\s+(?:A\s*(\d{3}))(?:\s*-\s*(\d{1,4})([A-Za-z]{0,3}))?(?:\s+(?:Passenger|Pax))?/gi;
  while ((m = boeingA.exec(text)) !== null) {
    const equip = parseExplicitAircraftString(m[0]);
    push(equip, m[0], m.index, m.index + m[0].length);
  }

  // 5. Airbus A350-1000 / A321neo / A330-300 / A220-300 Passenger
  const airbus = /\bAirbus\s*(A\s*\d{3})(?:\s*-\s*(\d{1,4})([A-Za-z]{0,3}))?(?:\s*(neo|ceo))?(?:\s+(Passenger|Pax))?/gi;
  airbus.lastIndex = 0;
  while ((m = airbus.exec(text)) !== null) {
    const fam = m[1].replace(/\s+/g, "").toUpperCase();
    const num = fam.replace(/^A/, "");
    const ser = m[2];
    const neo = m[4];
    const pax = m[5];
    let equip: string | null = null;
    const extraStr = `${neo ? "NEO" : ""} ${pax ? "PASSENGER" : ""}`.trim();
    if (ser) {
      equip = mapAircraft(`A${num}`, `${ser} ${extraStr}`, extraStr);
      if (!equip) equip = mapAircraft(fam, extraStr, extraStr);
    } else {
      equip = mapAircraft(fam, extraStr, extraStr);
    }
    push(equip, m[0], m.index, m.index + m[0].length);
  }

  // 6. Airbus without the word "Airbus": A350-900 / A330-300 / A321neo / A220-300 Passenger
  const airbusPlain = /\bA\s*(\d{3})\s*(?:-\s*(\d{1,4})([A-Za-z]{0,3}))?(?:\s*(neo|ceo))?(?:\s+(Passenger|Pax))?\b/gi;
  airbusPlain.lastIndex = 0;
  while ((m = airbusPlain.exec(text)) !== null) {
    const num = m[1];
    const ser = m[2];
    const neo = m[4];
    const pax = m[5];
    const fam = `A${num}`;
    const extraStr = `${neo ? "NEO" : ""} ${pax ? "PASSENGER" : ""}`.trim();
    let equip: string | null = null;
    if (ser) {
      equip = mapAircraft(`A${num}`, `${ser} ${extraStr}`, extraStr);
      if (!equip) equip = mapAircraft(fam, extraStr, extraStr);
    } else {
      equip = mapAircraft(fam, extraStr, extraStr);
    }
    push(equip, m[0], m.index, m.index + m[0].length);
  }

  // 7a. Embraer ERJ / EMB family: "Embraer ERJ-145", "ERJ 145", "EMB-145"
  const erj = /\b(?:Embraer\s*)?(?:ERJ|EMB)\s*-?\s*(\d{3})(?:\s+(?:Passenger|Pax))?/gi;
  erj.lastIndex = 0;
  while ((m = erj.exec(text)) !== null) {
    push(parseExplicitAircraftString(m[0]), m[0], m.index, m.index + m[0].length);
  }

  // 7b. Embraer 175 / 170 / E175 / E170
  const emb1 = /\bEmbraer\s*(?:Regional\s*Jet\s*|E\s*)?(\d{3})(?:\s+(?:Passenger|Pax))?/gi;
  emb1.lastIndex = 0;
  while ((m = emb1.exec(text)) !== null) {
    push(mapAircraft("Embraer", m[1]), m[0], m.index, m.index + m[0].length);
  }
  const emb2 = /(?<![A-Za-z0-9])E\s*(\d{3})(?![0-9])/gi;
  emb2.lastIndex = 0;
  while ((m = emb2.exec(text)) !== null) {
    push(mapAircraft("Embraer", m[1]), m[0], m.index, m.index + m[0].length);
  }

  // 8. ATR 72 / ATR42
  const atr = /\bATR\s*[- ]?(\d{2})?\b/gi;
  atr.lastIndex = 0;
  while ((m = atr.exec(text)) !== null) {
    push("ATR", m[0], m.index, m.index + m[0].length);
  }

  // 9. CRJ 900 / CRJ900 / CRJ700 / CRJ200
  const crj = /\bCRJ\s*[- ]?(\d{3})?\b/gi;
  crj.lastIndex = 0;
  while ((m = crj.exec(text)) !== null) {
    const num = m[1] || "";
    const code = num === "900" ? "900" : (mapAircraft("CRJ", num) || "CRJ");
    push(code, m[0], m.index, m.index + m[0].length);
  }

  // 10. "Bombardier Regional Jet 550" / "Canadair Regional Jet 900"
  const regJet = /\b(?:Bombardier|Canadair|Mitsubishi)?\s*Regional\s*Jet\s*[- ]?(\d{3,4})?(?:\s+(?:Passenger|Pax))?\b/gi;
  regJet.lastIndex = 0;
  while ((m = regJet.exec(text)) !== null) {
    push(m[1] ? m[1] : "CRJ", m[0], m.index, m.index + m[0].length);
  }

  // 11. "Canadair RJ 900" / "Bombardier RJ 900" -> 900
  const rjShort = /\b(?:Canadair|Bombardier|Mitsubishi)\s+RJ\s*-?\s*(\d{3,4})?(?:\s+(?:Passenger|Pax))?\b/gi;
  rjShort.lastIndex = 0;
  while ((m = rjShort.exec(text)) !== null) {
    push(m[1] ? m[1] : "900", m[0], m.index, m.index + m[0].length);
  }

  // 12. "Embraer Regional Jet 175"
  const embRegJet = /\bEmbraer\s*Regional\s*Jet\s*[- ]?(\d{3})?(?:\s+(?:Passenger|Pax))?\b/gi;
  embRegJet.lastIndex = 0;
  while ((m = embRegJet.exec(text)) !== null) {
    push(mapAircraft("Embraer", m[1] || ""), m[0], m.index, m.index + m[0].length);
  }

  // 13. Q400 / Dash 8-400 / Dash 8
  const q = /\b(?:Q(\d{3})|Dash\s*8\s*-\s*(\d{3})|Dash\s*8)\b/gi;
  q.lastIndex = 0;
  while ((m = q.exec(text)) !== null) {
    push(mapAircraft("Q", m[1] || m[2] || ""), m[0], m.index, m.index + m[0].length);
  }

  // 14. Boeing 717
  const b717 = /\bBoeing\s*717\b/gi;
  b717.lastIndex = 0;
  while ((m = b717.exec(text)) !== null) {
    push("717", m[0], m.index, m.index + m[0].length);
  }

  return tokens.sort((a, b) => a.start - b.start);
}
