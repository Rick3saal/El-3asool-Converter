import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./utils/cn";
import { assembleFromSegments, convertFlights, convertToSabre } from "./lib/converter";
import type { Cabin, ConverterResult, Issue, Segment } from "./lib/types";
import { ocrImage } from "./lib/ocr";
import {
  DEFAULT_AI_SETTINGS,
  defaultModelFor,
  extractFlightsWithAI,
  type AiProvider,
  type AiSettings,
} from "./lib/ai";
import {
  clearLearned,
  flightKey,
  forgetAircraft,
  forgetFlight,
  forgetItinerary,
  isLearningEnabled,
  learnAircraft,
  learnFlight,
  learnItinerary,
  listLearnedAircraft,
  listLearnedFlights,
  listLearnedItineraries,
  setLearningEnabled,
  type AircraftCorrection,
  type FlightCorrection,
  type LearnedItinerary,
} from "./lib/learning";

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

const CABIN_OPTIONS: Array<{ value: Cabin; label: string; hint: string }> = [
  { value: "ECONOMY", label: "Economy", hint: "class Y" },
  { value: "BUSINESS", label: "Business", hint: "class J" },
  { value: "PREMIUM", label: "Premium Economy", hint: "class R" },
  { value: "FIRST", label: "First", hint: "class I" },
];

const SAMPLE = `Round-trip, 1 traveler
Charlotte (CLT) → Budapest (BUD)

Wed, Dec 5
American Airlines 2509
Boeing 737
Charlotte (CLT) → Chicago (ORD)
Departure 2:54 PM · Arrival 4:10 PM
First (I)
Duration: 2 hr 16 min

Layover in Chicago (ORD)

Air Serbia 507
Chicago (ORD) → Belgrade (BEG)
Departure 5:30 PM · Arrival 10:20 AM +1
Business (W)
Duration: 9 hr 50 min
A330-200

Air Serbia 142
Belgrade (BEG) → Budapest (BUD)
Sat, Dec 6
Departure 1:30 PM · Arrival 2:40 PM
Economy (K)
Duration: 1 hr 10 min
ATR 72

Return

Sun, Dec 10
Air Serbia 143
Budapest (BUD) → Belgrade (BEG)
Departure 3:10 PM · Arrival 4:15 PM
Economy (K)
Duration: 1 hr 5 min

Mon, Dec 11
Air Serbia 506
Belgrade (BEG) → Chicago (ORD)
Departure 10:45 AM · Arrival 2:45 PM
Business (W)
Duration: 11 hr 0 min

American Airlines 864
Chicago (ORD) → Charlotte (CLT)
Departure 4:45 PM · Arrival 7:57 PM
First (I)
Duration: 2 hr 12 min`;

type OcrStatus = "idle" | "processing" | "done" | "error";

interface ImageState {
  url: string;
  name: string;
  key: string;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const AI_LS_KEY = "el3asool.ai.settings.v1";

function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(AI_LS_KEY);
    if (raw) return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_AI_SETTINGS };
}

function saveAiSettings(s: AiSettings): void {
  try {
    localStorage.setItem(AI_LS_KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

/* compare two segments field-by-field (ignores identity) */
function shallowSame(a: Segment, b: Segment): boolean {
  return (
    a.airline === b.airline &&
    a.num === b.num &&
    a.date.day === b.date.day &&
    a.date.month === b.date.month &&
    a.origin === b.origin &&
    a.dest === b.dest &&
    a.dep === b.dep &&
    a.arr === b.arr &&
    a.arrDay === b.arrDay &&
    a.equip === b.equip &&
    a.elapsed === b.elapsed &&
    a.cabin === b.cabin &&
    a.bookingClass === b.bookingClass &&
    (a.operatedBy ?? "") === (b.operatedBy ?? "") &&
    a.direction === b.direction
  );
}

const minToTimeInput = (min: number): string =>
  `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const timeInputToMin = (v: string): number => {
  const [h, m] = v.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function looksLikeUrlOnly(text: string): boolean {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) || /^data:image\//i.test(t);
}

/* ------------------------------------------------------------------ */
/* small components                                                    */
/* ------------------------------------------------------------------ */

function CopyButton({
  label,
  copied,
  disabled,
  onCopy,
  className,
}: {
  label: string;
  copied: boolean;
  disabled?: boolean;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      className={cn(
        "rounded-lg border px-3.5 py-1.5 text-xs font-bold tracking-wide transition-all duration-200",
        copied
          ? "border-emerald-400/45 bg-emerald-400/15 text-emerald-300 shadow-[0_0_20px_rgba(52,211,153,0.18)]"
          : "border-honey/35 bg-honey/[0.08] text-honey hover:border-honey/60 hover:bg-honey/20 hover:shadow-[0_0_22px_rgba(245,197,24,0.22)] active:scale-95",
        disabled && "cursor-not-allowed opacity-35 hover:border-honey/35 hover:bg-honey/[0.08] hover:shadow-none",
        className
      )}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function OutputCard({
  title,
  text,
  emptyText,
  copied,
  onCopy,
  fill,
}: {
  title: string;
  text: string;
  emptyText?: string;
  copied: boolean;
  onCopy: () => void;
  /** fills its grid cell with an internal scroll area on large screens */
  fill?: boolean;
}) {
  const has = text.length > 0;
  const lineCount = has ? text.split("\n").filter((l) => l.trim()).length : 0;
  return (
    <section
      className={cn(
        "glass glass-hover fade-up group relative overflow-hidden rounded-2xl",
        fill && "lg:flex lg:min-h-0 lg:flex-col"
      )}
    >
      <div className="card-accent absolute inset-x-0 top-0 h-px opacity-70 transition-opacity duration-300 group-hover:opacity-100" />
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full transition-colors",
              has ? "bg-honey shadow-[0_0_10px_rgba(245,197,24,0.8)]" : "bg-slate-600"
            )}
          />
          <h3 className="text-[11px] font-bold tracking-[0.22em] text-slate-200">{title}</h3>
          {has && (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[9.5px] font-semibold tabular-nums text-slate-400">
              {lineCount}
            </span>
          )}
        </div>
        <CopyButton label="Copy" copied={copied} disabled={!has} onCopy={onCopy} />
      </header>
      {has ? (
        <pre
          className={cn(
            "sabre-scroll overflow-x-auto whitespace-pre px-5 py-4 font-mono text-[12.5px] leading-[1.8] text-slate-100 selection:bg-honey/30 lg:min-h-0 lg:flex-1 lg:overflow-auto",
            fill && "lg:text-[11.5px] min-[1800px]:text-[12.5px]"
          )}
        >
          {text}
        </pre>
      ) : (
        <p className="px-5 py-4 text-[12.5px] italic text-slate-500">{emptyText ?? "—"}</p>
      )}
    </section>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const styles =
    issue.level === "error"
      ? "border-rose-400/25 bg-rose-400/[0.06] text-rose-200"
      : issue.level === "warn"
        ? "border-amber-300/25 bg-amber-300/[0.06] text-amber-200"
        : "border-sky-300/20 bg-sky-300/[0.05] text-sky-200";
  const icon = issue.level === "error" ? "⚠" : issue.level === "warn" ? "!" : "✦";
  return (
    <div
      className={cn(
        "fade-up flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-relaxed",
        styles
      )}
    >
      <span className="mt-px shrink-0 text-[11px] opacity-70">{icon}</span>
      <span className="min-w-0">{issue.text}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* app                                                                 */
/* ------------------------------------------------------------------ */

export default function App() {
  const [text, setText] = useState("");
  const [image, setImage] = useState<ImageState | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>("idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrError, setOcrError] = useState("");
  const [fallbackCabin, setFallbackCabin] = useState<Cabin | null>(null);
  const [result, setResult] = useState<ConverterResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pasteHint, setPasteHint] = useState("");

  /* ---- edit & self-learning state ---- */
  const [edited, setEdited] = useState<Segment[] | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [learningOn, setLearningOn] = useState(isLearningEnabled());
  const [learnedOpen, setLearnedOpen] = useState(false);
  const [learnedVersion, setLearnedVersion] = useState(0);

  /* ---- AI-assist state ---- */
  const [ai, setAi] = useState<AiSettings>(() => loadAiSettings());
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiNote, setAiNote] = useState("");
  const aiAutoRef = useRef<string>("");

  const cacheRef = useRef(new Map<string, ConverterResult>());
  const lastImageRef = useRef<{ key: string; ocrText: string } | null>(null);
  const copyTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* ---------- conversion (300ms debounce, cached) ---------- */
  const convert = useCallback((raw: string, cabin: Cabin | null): ConverterResult => {
    const key = `${cabin ?? "·"}::${raw}`;
    const hit = cacheRef.current.get(key);
    if (hit) return hit;
    const out = convertToSabre(raw, cabin);
    if (cacheRef.current.size > 60) cacheRef.current.clear();
    cacheRef.current.set(key, out);
    return out;
  }, []);

  useEffect(() => {
    if (!text.trim()) {
      setResult(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setResult(convert(text, fallbackCabin));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [text, fallbackCabin, convert]);

  /* ---- edited segments: a fresh parse resets the working copy ---- */
  useEffect(() => {
    setEdited(result ? result.segments.map((s) => ({ ...s })) : null);
  }, [result]);

  /* ---- live result: edited segments re-enter the SAME formatter/validator ---- */
  const liveResult: ConverterResult | null = useMemo(() => {
    if (!result) return result;
    if (!edited) return result;
    const same =
      edited.length === result.segments.length &&
      edited.every((s, i) => s === result.segments[i] || shallowSame(s, result.segments[i]));
    if (same) return result;
    // re-validate the EDITED output; stale internal checks from the original
    // parse are replaced by fresh ones, parse-time notes are kept.
    const carriedIssues = result.issues.filter((i) => !i.text.startsWith("Internal:"));
    return assembleFromSegments(edited, carriedIssues, result.missingCabinFlights);
  }, [result, edited]);

  const editedCount = useMemo(() => {
    if (!result || !edited) return 0;
    let n = 0;
    for (let i = 0; i < Math.min(edited.length, result.segments.length); i++) {
      if (!shallowSame(edited[i], result.segments[i])) n++;
    }
    return n;
  }, [result, edited]);

  /* ---- edit one field of one segment; learn it when self-learning is on ---- */
  const updateSegment = useCallback(
    (idx: number, patch: Partial<Segment>) => {
      setEdited((prev) => {
        if (!prev) return prev;
        const next = prev.map((s, i) => (i === idx ? { ...s, ...patch } : s));
        if (learningOn) {
          const seg = next[idx];
          learnFlight(seg);
          if (patch.equip && seg.equipRaw && patch.equip !== result?.segments[idx]?.equip) {
            learnAircraft(seg.equipRaw, seg.equip);
          }
          setLearnedVersion((v) => v + 1);
        }
        return next;
      });
    },
    [learningOn, result]
  );

  const resetEdits = useCallback(() => {
    setEdited(result ? result.segments.map((s) => ({ ...s })) : null);
  }, [result]);

  const learnedRules = useMemo(
    () => ({
      itineraries: listLearnedItineraries(),
      flights: listLearnedFlights(),
      aircraft: listLearnedAircraft(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [learnedVersion, result]
  );

  const handleForgetItinerary = useCallback((id: string) => {
    forgetItinerary(id);
    setLearnedVersion((v) => v + 1);
  }, []);

  const handleForgetFlight = useCallback(
    (key: string) => {
      forgetFlight(key);
      setLearnedVersion((v) => v + 1);
    },
    []
  );
  const handleForgetAircraft = useCallback((phrase: string) => {
    forgetAircraft(phrase);
    setLearnedVersion((v) => v + 1);
  }, []);
  const handleClearLearned = useCallback(() => {
    clearLearned();
    setLearnedVersion((v) => v + 1);
  }, []);
  const toggleLearning = useCallback((on: boolean) => {
    setLearningOn(on);
    setLearningEnabled(on);
  }, []);

  /* ---- AI assist ---- */
  const updateAi = useCallback((patch: Partial<AiSettings>) => {
    setAi((prev) => {
      const next = { ...prev, ...patch };
      saveAiSettings(next);
      return next;
    });
  }, []);

  const runAi = useCallback(
    async (rawText: string) => {
      if (!ai.apiKey) {
        setAiError("Add your API key in the AI Assist panel first.");
        setAiOpen(true);
        return;
      }
      if (!rawText.trim()) return;
      setAiBusy(true);
      setAiError("");
      setAiNote("");
      try {
        const flights = await extractFlightsWithAI(rawText, ai);
        const out = convertFlights(flights, fallbackCabin);
        setResult(out);

        // Auto-learn when learning is enabled so the user never needs AI again for this flight!
        if (learningOn) {
          learnItinerary(rawText, flights);
          out.segments.forEach((seg) => learnFlight(seg));
          setLearnedVersion((v) => v + 1);
          setAiNote(
            `🧠 AI read ${flights.length} flight${flights.length > 1 ? "s" : ""} and saved to memory! Future conversions of this itinerary will work automatically without AI.`
          );
        } else {
          setAiNote(`AI read ${flights.length} flight${flights.length > 1 ? "s" : ""}. Review the output below.`);
        }
      } catch (e) {
        setAiError(e instanceof Error ? e.message : "AI extraction failed.");
      } finally {
        setAiBusy(false);
      }
    },
    [ai, fallbackCabin, learningOn]
  );

  /* Auto-run AI when it is enabled and the local parser could not build a
   * complete result (missing fields / skipped flights). Manual button always
   * available. Never fires twice for the same unchanged input. */
  useEffect(() => {
    if (!ai.enabled || !ai.apiKey || !text.trim()) return;
    if (!result) return;
    const hasError = result.issues.some((i) => i.level === "error");
    const nothingBuilt = !result.hasOutput;
    if (!hasError && !nothingBuilt) return;
    const key = `${text}`;
    if (aiAutoRef.current === key) return;
    const t = window.setTimeout(() => {
      aiAutoRef.current = key;
      void runAi(text);
    }, 350);
    return () => window.clearTimeout(t);
  }, [ai.enabled, ai.apiKey, text, result, runAi]);

  /* ---------- image processing (OCR path, same converter) ---------- */
  const handleImageFile = useCallback(async (file: File) => {
    const key = `${file.size}-${file.name}-${file.lastModified}`;
    if (lastImageRef.current?.key === key) {
      // do not reprocess an unchanged image
      setOcrStatus("done");
      setText(lastImageRef.current.ocrText);
      return;
    }
    const url = URL.createObjectURL(file);
    setImage({ url, name: file.name, key });
    setOcrStatus("processing");
    setOcrProgress(0);
    setOcrError("");
    try {
      const ocrText = await ocrImage(url, (p) => setOcrProgress(p));
      lastImageRef.current = { key, ocrText };
      setOcrStatus("done");
      setText(ocrText);
    } catch {
      setOcrStatus("error");
      setOcrError(
        "The OCR engine could not read this image (it may require an internet connection on first use). Try pasting the itinerary as text instead."
      );
    }
  }, []);

  /* ---------- global clipboard detection ---------- */
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const cd = e.clipboardData;
      if (!cd) return;
      let imageFile: File | null = null;
      let textData = "";
      try {
        for (const item of Array.from(cd.items)) {
          if (item.type.startsWith("image/")) {
            imageFile = item.getAsFile();
          } else if (item.type === "text/plain") {
            textData = cd.getData("text/plain") || "";
          }
        }
      } catch {
        /* ignore clipboard read errors */
      }
      const target = e.target as HTMLElement | null;
      const inTextarea = !!target && (target.tagName === "TEXTAREA" || !!target.closest("textarea"));
      const meaningfulText = textData.trim().length >= 40 && !looksLikeUrlOnly(textData);

      if (imageFile && !meaningfulText) {
        // screenshot / image on the clipboard → OCR path
        e.preventDefault();
        void handleImageFile(imageFile);
        return;
      }
      if (meaningfulText && !inTextarea) {
        // text pasted anywhere in the app → straight into the local parser
        e.preventDefault();
        setText(textData);
        return;
      }
      // text pasted into the textarea uses the native flow; the debounce
      // handler above converts it locally.
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleImageFile]);

  /* ---------- drag & drop / upload ---------- */
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
      if (file) void handleImageFile(file);
    },
    [handleImageFile]
  );

  const onPickFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleImageFile(file);
      e.target.value = "";
    },
    [handleImageFile]
  );

  const readClipboardImage = useCallback(async () => {
    try {
      if (!navigator.clipboard?.read) {
        setPasteHint("Clipboard reading is unavailable here — just press ⌘V / Ctrl+V.");
        return;
      }
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith("image/"));
        if (type) {
          const blob = await item.getType(type);
          void handleImageFile(new File([blob], "clipboard-image.png", { type }));
          setPasteHint("");
          return;
        }
      }
      setPasteHint("No image found on the clipboard — copy a screenshot first, then ⌘V / Ctrl+V.");
    } catch {
      setPasteHint("Clipboard reading was blocked — press ⌘V / Ctrl+V instead.");
    }
  }, [handleImageFile]);

  /* ---------- copy ---------- */
  const handleCopy = useCallback(
    async (key: string, value: string) => {
      if (!value) return;
      const ok = await copyToClipboard(value);
      if (!ok) {
        setPasteHint("Could not access the clipboard — allow clipboard access and try again.");
        return;
      }
      setCopied(key);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    },
    []
  );

  /* ---------- clear ---------- */
  const clearAll = useCallback(() => {
    setText("");
    setImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setOcrStatus("idle");
    setOcrProgress(0);
    setOcrError("");
    setFallbackCabin(null);
    setResult(null);
    setCopied(null);
    setPasteHint("");
    setEdited(null);
    lastImageRef.current = null;
    cacheRef.current.clear();
    inputRef.current?.focus();
  }, []);

  const showIssues = useMemo(() => {
    if (!liveResult) return [];
    return liveResult.issues.filter((i) => i.level !== "info");
  }, [liveResult]);

  const infoIssue = useMemo(() => {
    if (!liveResult) return null;
    return liveResult.issues.find((i) => i.level === "info") ?? null;
  }, [liveResult]);

  const outCount = liveResult?.segments.filter((s) => s.direction === "OUT").length ?? 0;
  const inCount = liveResult ? liveResult.segments.length - outCount : 0;

  const processing = ocrStatus === "processing";

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden lg:h-[100dvh] lg:min-h-0 lg:overflow-hidden">
      {/* backdrop */}
      <div className="pointer-events-none fixed inset-0">
        <div className="app-grid absolute inset-0" />
        <div className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(75%_60%_at_50%_-12%,rgba(245,197,24,0.16),transparent_70%)]" />
        <div className="aurora absolute -left-48 top-10 h-[420px] w-[420px] rounded-full bg-honey/[0.07] blur-[110px]" />
        <div className="aurora-slow absolute -right-48 top-72 h-[480px] w-[480px] rounded-full bg-amber-500/[0.06] blur-[120px]" />
        <div className="aurora absolute left-1/3 top-[60%] h-[380px] w-[380px] rounded-full bg-orange-400/[0.04] blur-[120px]" />
        <div className="absolute inset-x-0 bottom-0 h-80 bg-gradient-to-t from-[#05070d] to-transparent" />
      </div>

      {/* ============ compact top rail — one row on large screens ============ */}
      <header className="relative hidden shrink-0 items-center gap-4 border-b border-white/[0.07] bg-[#05070d]/60 px-4 py-2 backdrop-blur-md lg:flex lg:px-6">
        <div className="flex min-w-0 shrink-0 items-center gap-2.5">
          <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-lg">🍯</span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-extrabold leading-tight">
              <span className="text-gold">El 3asool Converter</span>
            </p>
            <p className="mt-0.5 truncate text-[9.5px] font-semibold tracking-[0.24em] text-slate-500">
              SABRE / GDS ITINERARY CONVERTER
            </p>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <span className="gold-rule hidden h-px flex-1 lg:block" />
          <span className="text-[10px] text-honey/60">✦</span>
          <div
            dir="rtl"
            lang="ar"
            className="font-arabic whitespace-nowrap px-1 text-[1.05rem] leading-7 text-amber-50 [text-shadow:0_2px_18px_rgba(245,197,24,0.25)] lg:text-[1.2rem]"
          >
            اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ
          </div>
          <span className="text-[10px] text-honey/60">✦</span>
          <span className="gold-rule hidden h-px flex-1 lg:block" />
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-honey/25 bg-honey/[0.07] px-3 py-1 text-[9.5px] font-bold tracking-[0.3em] text-honey">
            <span className="glow-pulse h-1.5 w-1.5 rounded-full bg-honey" />
            SABRE / GDS
          </span>
          <p className="hidden text-right text-[9.5px] leading-tight tracking-wide text-slate-600 2xl:block">
            Made by <span className="text-slate-500">Ziad El Asaal</span>
          </p>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-5xl flex-col px-4 pb-20 pt-9 sm:px-6 lg:min-h-0 lg:max-w-none lg:flex-1 lg:px-5 lg:pb-4 lg:pt-4 2xl:px-6">
        {/* ============ header (small screens) ============ */}
        <header className="text-center lg:hidden">
          {/* Arabic remembrance — framed, centered, RTL */}
          <div className="fade-up relative mx-auto max-w-3xl">
            <div className="pointer-events-none absolute inset-0 -z-10 rounded-[28px] bg-[radial-gradient(60%_100%_at_50%_50%,rgba(245,197,24,0.10),transparent_72%)]" />
            <div className="flex items-center justify-center gap-4 px-2">
              <span className="gold-rule hidden h-px flex-1 sm:block" />
              <span className="text-xs text-honey/60">✦</span>
              <span className="gold-rule hidden h-px flex-1 sm:block" />
            </div>
            <div
              dir="rtl"
              lang="ar"
              className="font-arabic px-3 py-5 text-[2rem] leading-[2.7rem] text-amber-50 [text-shadow:0_2px_26px_rgba(245,197,24,0.28)] sm:text-[2.6rem] sm:leading-[3.6rem]"
            >
            اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ
            </div>
            <div className="flex items-center justify-center gap-4 px-2">
              <span className="gold-rule hidden h-px flex-1 sm:block" />
              <span className="text-xs text-honey/60">✦</span>
              <span className="gold-rule hidden h-px flex-1 sm:block" />
            </div>
          </div>

          <div className="mt-9">
            <span className="inline-flex items-center gap-2 rounded-full border border-honey/25 bg-honey/[0.07] px-3.5 py-1 text-[10px] font-bold tracking-[0.38em] text-honey">
              <span className="glow-pulse h-1.5 w-1.5 rounded-full bg-honey" />
              SABRE / GDS
            </span>
          </div>

          <h1 className="relative mt-3.5 text-[2.6rem] font-extrabold leading-[1.1] tracking-tight sm:text-[3.4rem]">
            <span className="text-gold">El 3asool Converter</span>{" "}
            <span
              role="img"
              aria-label="honey"
              className="inline-block align-middle drop-shadow-[0_4px_18px_rgba(245,197,24,0.45)]"
            >
              🍯
            </span>
          </h1>

          <p className="mt-4 text-[12.5px] font-medium text-slate-400">
            Made by{" "}
            <span className="bg-gradient-to-r from-amber-100 to-honey bg-clip-text font-semibold text-transparent">
              Ziad El Asaal
            </span>
          </p>
        </header>

        {/* ============ workspace — paste left, answers right ============ */}
        <div className="mt-9 flex flex-col gap-4 lg:mt-0 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:grid-rows-[minmax(0,1fr)] lg:items-stretch">
          {/* ============ input card (left pane) ============ */}
          <section className="glass fade-up flex flex-col rounded-2xl lg:min-h-0 lg:overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5 lg:shrink-0">
            <h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-slate-300">
              <span className="text-honey/70">❯</span>
              PASTE ITINERARY — TEXT OR SCREENSHOT
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAiOpen((v) => !v)}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:-translate-y-px",
                  ai.enabled && ai.apiKey
                    ? "border-honey/45 bg-honey/[0.12] text-honey shadow-[0_0_18px_rgba(245,197,24,0.16)] hover:bg-honey/20"
                    : "border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
                )}
                title="Use an AI model to read unfamiliar itinerary layouts"
              >
                🧭 AI Assist{ai.enabled && ai.apiKey ? " · on" : ""}
              </button>
              <button
                type="button"
                onClick={readClipboardImage}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:-translate-y-px hover:border-white/25 hover:bg-white/[0.07] hover:text-white"
              >
                Paste screenshot
              </button>
              <label className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:-translate-y-px hover:border-white/25 hover:bg-white/[0.07] hover:text-white">
                Upload image
                <input type="file" accept="image/*" className="hidden" onChange={onPickFile} />
              </label>
              <button
                type="button"
                onClick={clearAll}
                className="rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-semibold text-rose-200/90 transition hover:-translate-y-px hover:border-rose-300/45 hover:bg-rose-400/10 hover:text-rose-100"
              >
                Clear
              </button>
            </div>
            </div>

            {/* scrollable paste area — toolbar stays pinned, the box fills the pane */}
            <div className="sabre-scroll px-4 pb-4 pt-3.5 sm:px-5 sm:pb-5 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
            <div
              onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={cn(
              "relative rounded-xl border transition-all duration-300 lg:flex lg:min-h-[190px] lg:flex-1 lg:flex-col",
              processing
                ? "border-honey/45 bg-honey/[0.04]"
                : "border-white/10 bg-slate-950/70 focus-within:border-honey/55 focus-within:shadow-[0_0_0_4px_rgba(245,197,24,0.07)]"
            )}
          >
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder={"Paste a flight itinerary here…\n\nText works: ⌘V / Ctrl+V\nScreenshots work too: ⌘V / Ctrl+V directly in this box\n\nOr drag & drop an image."}
              className="sabre-scroll block min-h-[190px] w-full resize-y rounded-xl bg-transparent p-4 font-mono text-[13px] leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none lg:min-h-0 lg:flex-1 lg:resize-none"
            />

            {/* OCR overlay */}
            {processing && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-slate-950/70 backdrop-blur-[2px]">
                <div className="flex items-center gap-3 rounded-xl border border-honey/30 bg-slate-900/90 px-5 py-3.5 shadow-xl">
                  <svg className="spin-slow h-5 w-5 text-honey" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-amber-100">Reading screenshot…</p>
                    <p className="text-xs text-slate-400">Extracting itinerary {ocrProgress > 0 ? `· ${ocrProgress}%` : ""}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* image preview */}
          {image && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/50 p-3">
              <img
                src={image.url}
                alt="Pasted itinerary screenshot"
                className="max-h-28 rounded-lg border border-white/10 object-contain"
              />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="truncate text-xs font-semibold text-slate-200">{image.name}</p>
                {ocrStatus === "done" && (
                  <p className="mt-1 text-xs leading-relaxed text-emerald-300/90">
                    Screenshot read ✓ — extracted text is in the box above (editable) and was converted with the
                    same Sabre engine as typed text.
                  </p>
                )}
                {ocrStatus === "error" && <p className="mt-1 text-xs leading-relaxed text-rose-300">{ocrError}</p>}
                <button
                  type="button"
                  onClick={() => {
                    setImage((prev) => {
                      if (prev) URL.revokeObjectURL(prev.url);
                      return null;
                    });
                  }}
                  className="mt-2 rounded-md border border-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-400 transition hover:text-white"
                >
                  Remove image
                </button>
              </div>
            </div>
          )}

          {/* fallback cabin prompt (only when genuinely needed) */}
          {result && result.missingCabinFlights.length > 0 && !fallbackCabin && (
            <div className="fade-up mt-4 rounded-xl border border-amber-300/25 bg-amber-300/[0.05] p-4">
              <p className="text-sm font-semibold text-amber-200">
                Cabin not stated in the itinerary{" "}
                <span className="font-normal text-amber-200/70">
                  ({result.missingCabinFlights.length} flight{result.missingCabinFlights.length > 1 ? "s" : ""}:{" "}
                  {result.missingCabinFlights.join(" · ")})
                </span>
              </p>
              <p className="mt-1 text-xs text-amber-200/60">
                Choose the cabin to assign its default booking class:
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {CABIN_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setFallbackCabin(c.value)}
                    className="rounded-lg border border-honey/40 bg-honey/10 px-3.5 py-1.5 text-xs font-bold text-honey transition hover:bg-honey/20"
                  >
                    {c.label} <span className="font-normal opacity-70">· {c.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {fallbackCabin && result && result.missingCabinFlights.length === 0 && (
            <div className="mt-3 flex items-center justify-between rounded-lg border border-emerald-300/20 bg-emerald-300/[0.05] px-3.5 py-2">
              <p className="text-xs text-emerald-200/90">
                Cabin <span className="font-bold">{CABIN_OPTIONS.find((c) => c.value === fallbackCabin)?.label}</span>{" "}
                applied to flights without a stated cabin.
              </p>
              <button
                type="button"
                onClick={() => setFallbackCabin(null)}
                className="text-[11px] font-semibold text-slate-400 underline-offset-2 hover:text-white hover:underline"
              >
                Undo
              </button>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
            <p>
              Paste with <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono">⌘V</kbd> /{" "}
              <kbd className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono">Ctrl+V</kbd> · text
              converts locally &amp; instantly · screenshots go through in-browser OCR
            </p>
            <button
              type="button"
              onClick={() => setText(SAMPLE)}
              className="font-semibold text-honey/80 underline-offset-2 transition hover:text-honey hover:underline"
            >
              Try an example
            </button>
          </div>
          {pasteHint && <p className="mt-2 text-[11.5px] text-rose-300/90">{pasteHint}</p>}

          {aiNote && <p className="mt-2 text-[11.5px] text-emerald-300/90">{aiNote}</p>}
          {aiError && <p className="mt-2 text-[11.5px] text-rose-300/90">{aiError}</p>}

          {/* ---- AI Assist panel ---- */}
          {aiOpen && (
            <div className="fade-up mt-4 rounded-xl border border-honey/25 bg-honey/[0.04] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-amber-100">🧭 AI Assist</p>
                  <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-amber-200/70">
                    Let an AI model read itineraries in layouts the local parser has never seen. Your key is stored
                    only in this browser and calls go straight to the provider. When on, AI runs automatically only
                    when the local parser can’t build a complete result; you can also trigger it any time.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runAi(text)}
                    disabled={aiBusy || !text.trim()}
                    className="rounded-lg bg-honey px-3.5 py-2 text-xs font-bold text-amber-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {aiBusy ? "Reading…" : "Read with AI"}
                  </button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Provider</label>
                  <select
                    className={inputCls}
                    value={ai.provider}
                    onChange={(e) => {
                      const provider = e.target.value as AiProvider;
                      updateAi({ provider, model: defaultModelFor(provider) });
                    }}
                  >
                    <option value="gemini">Google Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="custom">Custom (OpenAI-compatible)</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Model</label>
                  <input
                    className={inputCls}
                    value={ai.model}
                    placeholder={defaultModelFor(ai.provider)}
                    onChange={(e) => updateAi({ model: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>API key</label>
                  <input
                    type="password"
                    className={inputCls}
                    value={ai.apiKey}
                    placeholder="paste your API key"
                    autoComplete="off"
                    onChange={(e) => updateAi({ apiKey: e.target.value })}
                  />
                </div>
                {ai.provider === "custom" && (
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Base URL</label>
                    <input
                      className={inputCls}
                      value={ai.baseUrl}
                      placeholder="https://your-endpoint/v1"
                      onChange={(e) => updateAi({ baseUrl: e.target.value })}
                    />
                  </div>
                )}
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className="text-[11.5px] text-amber-200/80">
                  Enable AI Assist
                  <span className="ml-1.5 text-[10.5px] text-amber-200/50">(auto-runs when the local parser fails)</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={ai.enabled}
                  onClick={() => updateAi({ enabled: !ai.enabled })}
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    ai.enabled ? "bg-honey" : "bg-slate-700"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
                      ai.enabled ? "left-[22px]" : "left-0.5"
                    )}
                  />
                </button>
              </div>
            </div>
          )}

            {/* ============ issues — left pane, under the paste box ============ */}
            {(showIssues.length > 0 || infoIssue) && (
              <div className="mt-3 space-y-2 lg:shrink-0">
                {showIssues.map((issue, idx) => (
                  <IssueRow key={idx} issue={issue} />
                ))}
                {infoIssue && <IssueRow issue={infoIssue} />}
              </div>
            )}

            {/* ---- review & edit flights ---- */}
            {liveResult && liveResult.hasOutput && (
              <div className="mt-3 space-y-3 lg:shrink-0">
                <FlightEditor
                  open={editorOpen}
                  onToggle={() => setEditorOpen((v) => !v)}
                  segments={edited ?? liveResult.segments}
                  resultSegments={result?.segments ?? []}
                  editedCount={editedCount}
                  onUpdate={updateSegment}
                  onReset={resetEdits}
                  learningOn={learningOn}
                />

                {/* ---- self-learning manager ---- */}
                <LearningPanel
                  open={learnedOpen}
                  onToggle={() => setLearnedOpen((v) => !v)}
                  learningOn={learningOn}
                  onToggleLearning={toggleLearning}
                  itineraries={learnedRules.itineraries}
                  flights={learnedRules.flights}
                  aircraft={learnedRules.aircraft}
                  onForgetItinerary={handleForgetItinerary}
                  onForgetFlight={handleForgetFlight}
                  onForgetAircraft={handleForgetAircraft}
                  onClearAll={handleClearLearned}
                />
              </div>
            )}
            </div>
          </section>

          {/* ============ answers (right pane) ============ */}
          <section className="flex flex-col gap-4 lg:min-h-0 lg:gap-3">
            {liveResult && liveResult.hasOutput ? (
              <>
                <div className="flex flex-wrap items-center justify-center gap-2 lg:shrink-0 lg:justify-between">
                  <h2 className="flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-slate-300">
                    <span className="text-honey/70">❯</span>
                    SABRE OUTPUT
                  </h2>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-honey/25 bg-honey/[0.07] px-3 py-1 text-[10.5px] font-bold tracking-[0.12em] text-honey">
                      <span className="h-1.5 w-1.5 rounded-full bg-honey" />
                      {liveResult.segments.length} SEGMENT{liveResult.segments.length > 1 ? "S" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10.5px] font-semibold tracking-[0.12em] text-slate-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-sky-400/80" />
                      {outCount} OUTBOUND
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10.5px] font-semibold tracking-[0.12em] text-slate-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-violet-400/80" />
                      {inCount} INBOUND
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-2 lg:gap-3">
                  <OutputCard
                    fill
                    title="SABRE ITINERARY"
                    text={liveResult.itinerary}
                    emptyText="Paste an itinerary to build the main entry."
                    copied={copied === "itin"}
                    onCopy={() => void handleCopy("itin", liveResult.itinerary)}
                  />
                  <OutputCard
                    fill
                    title="OUTBOUND"
                    text={liveResult.outbound}
                    emptyText="No outbound flights."
                    copied={copied === "out"}
                    onCopy={() => void handleCopy("out", liveResult.outbound)}
                  />
                  <OutputCard
                    fill
                    title="INBOUND"
                    text={liveResult.inbound}
                    emptyText="No inbound flights."
                    copied={copied === "in"}
                    onCopy={() => void handleCopy("in", liveResult.inbound)}
                  />
                  <OutputCard
                    fill
                    title="INDIVIDUAL"
                    text={liveResult.individual}
                    emptyText="—"
                    copied={copied === "ind"}
                    onCopy={() => void handleCopy("ind", liveResult.individual)}
                  />
                </div>
              </>
            ) : (
              <div className="fade-up flex flex-1 flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.09] bg-white/[0.015] px-6 py-16 text-center">
                {text.trim() ? (
                  <p className="text-sm text-slate-500">
                    Nothing convertible yet — check the notes above, or adjust the itinerary text.
                  </p>
                ) : (
                  <>
                    <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center">
                      <span className="absolute inset-0 rounded-2xl bg-honey/10 blur-xl" />
                      <span className="glass relative flex h-16 w-16 items-center justify-center rounded-2xl text-3xl">
                        🍯
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-slate-300">
                      Sabre output will appear here automatically
                    </p>
                    <p className="mt-1.5 text-xs text-slate-500">
                      Paste an itinerary on the left — text or screenshot — no Convert button needed.
                    </p>
                    <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[10px] font-semibold tracking-wider text-slate-500">
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">ITINERARY</span>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">OUTBOUND</span>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">INBOUND</span>
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1">INDIVIDUAL</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </section>
        </div>

        <footer className="mt-12 pb-4 text-center lg:hidden">
          <div className="gold-rule mx-auto mb-4 h-px w-40 opacity-50" />
          <p className="text-[10.5px] tracking-wide text-slate-600">
            El 3asool Converter 🍯 · SABRE / GDS · Made by{" "}
            <span className="text-slate-500">Ziad El Asaal</span>
          </p>
        </footer>
      </main>
    </div>
  );
}

/* ================================================================== */
/* Flight editor — review & correct every parsed segment, live.       */
/* ================================================================== */

const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

const inputCls =
  "w-full rounded-md border border-white/10 bg-slate-950/70 px-2 py-1.5 text-[12.5px] font-semibold text-slate-100 outline-none transition focus:border-honey/60 focus:ring-1 focus:ring-honey/30";
const labelCls = "block text-[9.5px] font-bold uppercase tracking-[0.14em] text-slate-500";

interface FlightEditorProps {
  open: boolean;
  onToggle: () => void;
  segments: Segment[];
  resultSegments: Segment[];
  editedCount: number;
  onUpdate: (idx: number, patch: Partial<Segment>) => void;
  onReset: () => void;
  learningOn: boolean;
}

function FlightEditor({
  open,
  onToggle,
  segments,
  resultSegments,
  editedCount,
  onUpdate,
  onReset,
  learningOn,
}: FlightEditorProps) {
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-slate-300">
          <span aria-hidden>✏️</span> REVIEW &amp; EDIT FLIGHTS
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
            {segments.length}
          </span>
          {editedCount > 0 && (
            <span className="rounded-full border border-honey/40 bg-honey/10 px-2 py-0.5 text-[10px] font-bold text-honey">
              {editedCount} edited
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          {editedCount > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onReset();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation();
                  onReset();
                }
              }}
              className="rounded-md border border-white/10 px-2 py-1 text-[10.5px] font-semibold text-slate-400 transition hover:border-white/25 hover:text-white"
            >
              Reset edits
            </span>
          )}
          <svg
            className={cn("h-4 w-4 text-slate-500 transition-transform", open && "rotate-180")}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/10 p-3 sm:p-4">
          <p className="text-[11px] leading-relaxed text-slate-500">
            Every field below is editable — the Sabre output above updates instantly.
            {learningOn
              ? " With self-learning on, your corrections are remembered per flight and applied automatically next time."
              : " Turn self-learning on to remember these corrections for future conversions."}
          </p>
          {segments.map((s, idx) => {
            const original = resultSegments[idx];
            const isEdited = original && !shallowSame(s, original);
            return (
              <div
                key={idx}
                className={cn(
                  "rounded-xl border bg-slate-950/50 p-3 transition-colors",
                  isEdited ? "border-honey/40" : "border-white/10"
                )}
              >
                <div className="mb-2.5 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-slate-300">
                    Flight {idx + 1} · {s.airline} {s.num}
                    {isEdited && <span className="ml-2 text-[10px] font-semibold text-honey">edited ✓</span>}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[9.5px] font-bold",
                      s.direction === "OUT" ? "bg-emerald-400/10 text-emerald-300" : "bg-sky-400/10 text-sky-300"
                    )}
                  >
                    {s.direction === "OUT" ? "OUTBOUND" : "INBOUND"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  <div>
                    <label className={labelCls}>Airline</label>
                    <input
                      className={cn(inputCls, "uppercase")}
                      value={s.airline}
                      maxLength={3}
                      onChange={(e) => onUpdate(idx, { airline: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Flight no</label>
                    <input
                      className={cn(inputCls, "uppercase")}
                      value={s.num}
                      maxLength={5}
                      onChange={(e) => onUpdate(idx, { num: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Date day</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      className={inputCls}
                      value={s.date.day}
                      onChange={(e) =>
                        onUpdate(idx, { date: { ...s.date, day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) } })
                      }
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Month</label>
                    <select
                      className={inputCls}
                      value={s.date.month}
                      onChange={(e) => onUpdate(idx, { date: { ...s.date, month: Number(e.target.value) } })}
                    >
                      {MONTHS.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>From</label>
                    <input
                      className={cn(inputCls, "uppercase")}
                      value={s.origin}
                      maxLength={3}
                      onChange={(e) => onUpdate(idx, { origin: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>To</label>
                    <input
                      className={cn(inputCls, "uppercase")}
                      value={s.dest}
                      maxLength={3}
                      onChange={(e) => onUpdate(idx, { dest: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Departure</label>
                    <input
                      type="time"
                      className={inputCls}
                      value={minToTimeInput(s.dep)}
                      onChange={(e) => e.target.value && onUpdate(idx, { dep: timeInputToMin(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Arrival</label>
                    <input
                      type="time"
                      className={inputCls}
                      value={minToTimeInput(s.arr)}
                      onChange={(e) => e.target.value && onUpdate(idx, { arr: timeInputToMin(e.target.value) })}
                    />
                  </div>

                  <div>
                    <label className={labelCls}>Arrives</label>
                    <select
                      className={inputCls}
                      value={s.arrDay}
                      onChange={(e) => onUpdate(idx, { arrDay: Number(e.target.value) as 0 | 1 | 2 })}
                    >
                      <option value={0}>same day</option>
                      <option value={1}>+1 day (¥1)</option>
                      <option value={2}>+2 days (¥2)</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Equipment</label>
                    <input
                      className={cn(inputCls, "uppercase")}
                      value={s.equip}
                      maxLength={4}
                      onChange={(e) => onUpdate(idx, { equip: e.target.value.toUpperCase() })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Elapsed (min)</label>
                    <input
                      type="number"
                      min={0}
                      className={inputCls}
                      value={s.elapsed}
                      onChange={(e) => onUpdate(idx, { elapsed: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Cabin</label>
                    <select
                      className={inputCls}
                      value={s.cabin}
                      onChange={(e) => onUpdate(idx, { cabin: e.target.value as Cabin })}
                    >
                      {CABIN_OPTIONS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className={labelCls}>Class</label>
                    <input
                      className={cn(inputCls, "uppercase")}
                      value={s.bookingClass}
                      maxLength={2}
                      onChange={(e) => onUpdate(idx, { bookingClass: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Direction</label>
                    <select
                      className={inputCls}
                      value={s.direction}
                      onChange={(e) => onUpdate(idx, { direction: e.target.value as "OUT" | "IN" })}
                    >
                      <option value="OUT">Outbound</option>
                      <option value="IN">Inbound</option>
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <label className={labelCls}>Operated by</label>
                    <input
                      className={inputCls}
                      value={s.operatedBy ?? ""}
                      placeholder="—"
                      onChange={(e) => onUpdate(idx, { operatedBy: e.target.value.toUpperCase() })}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/* Self-learning manager — learned flight & aircraft corrections.      */
/* ================================================================== */

interface LearningPanelProps {
  open: boolean;
  onToggle: () => void;
  learningOn: boolean;
  onToggleLearning: (on: boolean) => void;
  itineraries: LearnedItinerary[];
  flights: FlightCorrection[];
  aircraft: AircraftCorrection[];
  onForgetItinerary: (id: string) => void;
  onForgetFlight: (key: string) => void;
  onForgetAircraft: (phrase: string) => void;
  onClearAll: () => void;
}

function LearningPanel({
  open,
  onToggle,
  learningOn,
  onToggleLearning,
  itineraries,
  flights,
  aircraft,
  onForgetItinerary,
  onForgetFlight,
  onForgetAircraft,
  onClearAll,
}: LearningPanelProps) {
  const total = itineraries.length + flights.length + aircraft.length;
  return (
    <div className="glass overflow-hidden rounded-2xl">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold tracking-[0.25em] text-slate-300">
          <span aria-hidden>🧠</span> SELF-LEARNING
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
            {total} rule{total === 1 ? "" : "s"}
          </span>
        </span>
        <svg
          className={cn("h-4 w-4 text-slate-500 transition-transform", open && "rotate-180")}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-2.5">
        <span className="text-[11.5px] text-slate-400">
          Learn my corrections
          <span className="ml-1.5 hidden text-[10.5px] text-slate-600 sm:inline">
            (stored in this browser, applied to future conversions automatically)
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={learningOn}
          onClick={() => onToggleLearning(!learningOn)}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            learningOn ? "bg-honey" : "bg-slate-700"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all",
              learningOn ? "left-[22px]" : "left-0.5"
            )}
          />
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-white/10 p-3 sm:p-4">
          {total === 0 && (
            <p className="text-[11.5px] leading-relaxed text-slate-500">
              Nothing learned yet. When you use AI Assist to extract flights or edit any flight in “Review &amp; edit
              flights”, the tool automatically saves the itinerary, flights, and aircraft so future conversions of that
              same flight or itinerary work instantly without AI.
            </p>
          )}

          {itineraries.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Learned Itineraries (from AI)
              </p>
              <ul className="space-y-1.5">
                {itineraries.map((it) => (
                  <li
                    key={it.id}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="min-w-0 text-[11.5px] leading-relaxed text-slate-300">
                      <div className="font-bold text-slate-100 flex items-center gap-1.5">
                        <span className="text-honey">⚡</span> {it.summary}
                      </div>
                      <p className="truncate text-[10.5px] text-slate-500 mt-0.5">
                        “{it.originalSnippet}” · Learned {new Date(it.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onForgetItinerary(it.id)}
                      className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-slate-400 transition hover:border-rose-300/40 hover:text-rose-200"
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {flights.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Flight corrections
              </p>
              <ul className="space-y-1.5">
                {flights.map((f) => (
                  <li
                    key={flightKey(f.airline, f.num, f.origin, f.dest)}
                    className="flex items-start justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2"
                  >
                    <div className="min-w-0 text-[11.5px] leading-relaxed text-slate-300">
                      <span className="font-bold text-slate-100">
                        {f.airline} {f.num} · {f.origin} → {f.dest}
                      </span>
                      <span className="ml-2 text-slate-500">
                        {f.cabin} / {f.bookingClass} · {f.equip}
                        {f.operatedBy ? ` · op: ${f.operatedBy}` : ""}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onForgetFlight(flightKey(f.airline, f.num, f.origin, f.dest))}
                      className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-slate-400 transition hover:border-rose-300/40 hover:text-rose-200"
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {aircraft.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                Aircraft phrases
              </p>
              <ul className="space-y-1.5">
                {aircraft.map((a) => (
                  <li
                    key={a.phrase}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-[11.5px] text-slate-300"
                  >
                    <span className="truncate">
                      “{a.phrase}” <span className="text-slate-500">→</span>{" "}
                      <span className="font-bold text-slate-100">{a.equip}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => onForgetAircraft(a.phrase)}
                      className="shrink-0 rounded-md border border-white/10 px-2 py-0.5 text-[10.5px] font-semibold text-slate-400 transition hover:border-rose-300/40 hover:text-rose-200"
                    >
                      Forget
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {total > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="rounded-lg border border-rose-300/25 bg-rose-400/5 px-3 py-1.5 text-[11px] font-semibold text-rose-200/90 transition hover:border-rose-300/50 hover:bg-rose-400/10"
            >
              Clear all learned rules
            </button>
          )}
        </div>
      )}
    </div>
  );
}
