/** Parse "HH:MM" (24h), "h:mm AM/PM", or "855A" into minutes since midnight. */
export function timeToMinutes(input: string | undefined | null): number | null {
  if (!input) return null;
  const t = String(input).trim();
  if (!t) return null;

  // 12h with AM/PM
  const ap = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)$/i.exec(t);
  if (ap) {
    let h = parseInt(ap[1], 10) % 12;
    const m = ap[2] ? parseInt(ap[2], 10) : 0;
    if (ap[3].toLowerCase().startsWith("p")) h += 12;
    return h * 60 + m;
  }
  // 24h
  const c = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (c) {
    const h = parseInt(c[1], 10);
    const m = parseInt(c[2], 10);
    if (h <= 23 && m <= 59) return h * 60 + m;
  }
  // compact "855A" / "150P"
  const s = /^(\d{1,2})(\d{2})\s*([AP])$/i.exec(t);
  if (s) {
    let h = parseInt(s[1], 10) % 12;
    const m = parseInt(s[2], 10);
    if (s[3].toUpperCase() === "P") h += 12;
    return h * 60 + m;
  }
  return null;
}
