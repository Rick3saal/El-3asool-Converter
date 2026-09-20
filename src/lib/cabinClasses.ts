/**
 * Confirmed and learned airline booking class -> cabin mappings.
 *
 * Confirmed table: Standard, verified booking class letters for airlines.
 * Learned table: Answers taught by the user (persisted in localStorage).
 *
 * Rules:
 *  - A line with a class letter (e.g. Z on AF 191) is NEVER "cabin not stated".
 *  - If the pair is not in confirmed or learned, prompt: "What cabin is <AIRLINE> class <LETTER>?"
 *  - Save the answer as a learned row: "<AIRLINE>: <LETTER> = <CABIN>".
 *  - Class letter is kept exactly as given; never replaced by a default letter.
 */
import type { Cabin } from "./types";

export const CONFIRMED_CABIN_CLASSES: Record<string, Record<string, Cabin>> = {
  // Air France confirmed booking classes (Z is omitted so the user is asked)
  AF: {
    P: "FIRST",
    F: "FIRST",
    J: "BUSINESS",
    C: "BUSINESS",
    D: "BUSINESS",
    I: "BUSINESS",
    W: "PREMIUM",
    A: "PREMIUM",
    Y: "ECONOMY",
    B: "ECONOMY",
    M: "ECONOMY",
    U: "ECONOMY",
    K: "ECONOMY",
    H: "ECONOMY",
    L: "ECONOMY",
    Q: "ECONOMY",
    T: "ECONOMY",
    N: "ECONOMY",
    R: "ECONOMY",
    V: "ECONOMY",
    X: "ECONOMY",
    G: "ECONOMY",
  },
  // Global / industry-standard confirmed classes (Z is omitted)
  DEFAULT: {
    P: "FIRST",
    F: "FIRST",
    J: "BUSINESS",
    C: "BUSINESS",
    D: "BUSINESS",
    I: "BUSINESS",
    W: "PREMIUM",
    Y: "ECONOMY",
    B: "ECONOMY",
    M: "ECONOMY",
    H: "ECONOMY",
    Q: "ECONOMY",
    K: "ECONOMY",
    L: "ECONOMY",
    U: "ECONOMY",
    T: "ECONOMY",
    V: "ECONOMY",
    X: "ECONOMY",
    N: "ECONOMY",
    O: "ECONOMY",
    G: "ECONOMY",
    E: "ECONOMY",
  },
};

const LS_CLASSES = "el3asool.learned.classes.v1";

let memClasses = new Map<string, Cabin>();

function storage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    /* private mode / sandbox */
  }
  return null;
}

export function classKey(airline: string, letter: string): string {
  return `${(airline || "").toUpperCase().trim()}:${(letter || "").toUpperCase().trim()}`;
}

export function parseClassKey(key: string): { airline: string; letter: string } {
  const parts = key.split(":");
  return {
    airline: (parts[0] || "").trim(),
    letter: (parts[1] || "").trim(),
  };
}

export function getLearnedClasses(): Map<string, Cabin> {
  const s = storage();
  if (s) {
    try {
      const raw = s.getItem(LS_CLASSES);
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, Cabin>;
        return new Map(Object.entries(obj));
      }
    } catch {
      /* ignore corrupted json */
    }
  }
  return memClasses;
}

export function saveLearnedClass(airline: string, letter: string, cabin: Cabin): void {
  const key = classKey(airline, letter);
  const map = getLearnedClasses();
  map.set(key, cabin);
  const s = storage();
  if (s) {
    try {
      s.setItem(LS_CLASSES, JSON.stringify(Object.fromEntries(map)));
    } catch {
      /* quota */
    }
  } else {
    memClasses = new Map(map);
  }
}

export function removeLearnedClass(airline: string, letter: string): void {
  const key = classKey(airline, letter);
  const map = getLearnedClasses();
  map.delete(key);
  const s = storage();
  if (s) {
    try {
      s.setItem(LS_CLASSES, JSON.stringify(Object.fromEntries(map)));
    } catch {
      /* ignore */
    }
  } else {
    memClasses = new Map(map);
  }
}

export function clearLearnedClasses(): void {
  const s = storage();
  if (s) {
    try {
      s.removeItem(LS_CLASSES);
    } catch {
      /* ignore */
    }
  }
  memClasses = new Map();
}

/**
 * Returns the cabin for an airline + booking class letter if known in
 * the learned table or confirmed table; otherwise returns undefined.
 */
export function lookupCabinForClass(airline: string, letter: string): Cabin | undefined {
  if (!letter || letter.length !== 1) return undefined;
  const al = (airline || "").toUpperCase().trim();
  const cl = letter.toUpperCase().trim();

  // 1. Learned table takes priority
  const learned = getLearnedClasses().get(classKey(al, cl));
  if (learned) return learned;

  // 2. Confirmed airline-specific table
  if (CONFIRMED_CABIN_CLASSES[al]?.[cl]) {
    return CONFIRMED_CABIN_CLASSES[al][cl];
  }

  // 3. Confirmed global default table
  if (CONFIRMED_CABIN_CLASSES.DEFAULT?.[cl]) {
    return CONFIRMED_CABIN_CLASSES.DEFAULT[cl];
  }

  return undefined;
}

export function isClassConfirmedOrLearned(airline: string, letter: string): boolean {
  return lookupCabinForClass(airline, letter) !== undefined;
}

/** Provisional cabin to use for immediate rendering when the pair is unknown */
export function provisionalCabinFor(letter: string): Cabin {
  const cl = (letter || "").toUpperCase().trim();
  if (cl === "F" || cl === "P") return "FIRST";
  if (cl === "J" || cl === "C" || cl === "D" || cl === "I" || cl === "Z") return "BUSINESS";
  if (cl === "W" || cl === "A" || cl === "S") return "PREMIUM";
  return "ECONOMY";
}
