/* Shared types for the El 3asool Sabre converter */

export type Cabin = "FIRST" | "BUSINESS" | "PREMIUM" | "ECONOMY";

export interface ParsedDate {
  day: number; // 1-31, never zero-padded on output
  month: number; // 1-12
  year?: number;
}

export type Direction = "OUT" | "IN";

export interface RawFlight {
  /** Marketing carrier IATA code, e.g. MS */
  airline: string;
  /** Raw flight number digits as found, e.g. "85" */
  number: string;
  origin?: string;
  dest?: string;
  date?: ParsedDate;
  /** departure minutes since midnight (local) */
  dep?: number;
  /** arrival minutes since midnight (local) */
  arr?: number;
  /** explicit day offset markers from source (+1/+2/next day) or time-based */
  arrDay: 0 | 1 | 2;
  cabin?: Cabin;
  /** explicit booking class from source, e.g. "D" */
  bookingClass?: string;
  /** Sabre equipment code, e.g. 789 */
  equip?: string;
  /** raw aircraft text as printed in the source (for self-learning) */
  equipRaw?: string;
  /** elapsed minutes */
  elapsed?: number;
  /** explicit duration found in source */
  elapsedExplicit?: boolean;
  /** operating carrier display name, e.g. AIR CANADA EXPRESS - JAZZ */
  operatedBy?: string;
  /** reading order index */
  order: number;
  /** set true when merged from a technical stop */
  merged?: boolean;
  /** when a same-number pair was kept separate because of a layover */
  layover?: boolean;
  direction?: Direction;
}

/** A fully resolved, sellable Sabre segment */
export interface Segment {
  airline: string;
  /** flight number as displayed (2-digit numbers padded to 3) */
  num: string;
  date: ParsedDate;
  origin: string;
  dest: string;
  dep: number;
  arr: number;
  arrDay: 0 | 1 | 2;
  equip: string;
  /** raw aircraft text as printed in the source (for self-learning) */
  equipRaw?: string;
  elapsed: number;
  cabin: Cabin;
  bookingClass: string;
  operatedBy?: string;
  direction: Direction;
}

export type IssueLevel = "error" | "warn" | "info";

export interface Issue {
  level: IssueLevel;
  text: string;
}

export interface ConverterResult {
  itinerary: string; // main itinerary + <--additional-->
  outbound: string; // NN1 chains
  inbound: string; // NN1 chains
  individual: string; // GK1 per segment
  segments: Segment[];
  issues: Issue[];
  hasOutput: boolean;
  missingCabinFlights: string[]; // flights needing a cabin choice
}
