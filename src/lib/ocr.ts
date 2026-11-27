/**
 * IMAGE / SCREENSHOT PATH — OCR via Tesseract.js running fully in the browser.
 * The recognized text then flows through the SAME deterministic parser and
 * Sabre formatter as typed text. Text is never routed through this module.
 */
import Tesseract from "tesseract.js";
import { ocrCleanText } from "./parser";

let workerPromise: Promise<Tesseract.Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;
let suppressProgress = false;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", 1, {
      logger: (m: Tesseract.LoggerMessage) => {
        if (m.status === "recognizing text" && progressCb && !suppressProgress) {
          progressCb(Math.round(m.progress * 100));
        }
      },
    });
  }
  return workerPromise;
}

async function loadImage(src: string | File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load image"));
    if (typeof src === "string") img.src = src;
    else img.src = URL.createObjectURL(src);
  });
}

/** Upscale small screenshots and boost contrast for better full-page OCR. */
function prepareCanvas(img: HTMLImageElement): { canvas: HTMLCanvasElement; scale: number } {
  const maxW = 2200;
  // Scale both axes together. The old code enlarged only the canvas height for
  // typical screenshots, stretching letters vertically while leaving small
  // equipment / booking-class text at its original pixel width.
  const scale = Math.min(maxW / img.naturalWidth, 2.2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // Search-card secondary details are often gray-on-charcoal.
    ctx.filter = "grayscale(1) contrast(1.7) brightness(1.12)";
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
  return { canvas, scale };
}

/** A high-resolution, brightened horizontal strip for the fine-print pass. */
function prepareDetailStrip(
  img: HTMLImageElement,
  top: number,
  height: number
): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(2.2, 4400 / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // These strips contain airline IDs and aircraft/cabin labels in faint gray.
    ctx.filter = "grayscale(1) brightness(1.4) contrast(1.55)";
    ctx.drawImage(img, 0, top, img.naturalWidth, height, 0, 0, canvas.width, canvas.height);
  }
  return { canvas, scale };
}

interface OcrLine {
  text: string;
  y: number;
  x: number;
  confidence: number;
}

interface OcrBlockData {
  blocks?: Array<{
    paragraphs?: Array<{
      lines?: Array<{
        text?: string;
        confidence?: number;
        bbox?: { x0?: number; y0?: number; x1?: number; y1?: number };
      }>;
    }>;
  }>;
  text?: string;
}

function linesFromBlocks(data: OcrBlockData, yOffset: number, scale: number): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = (line.text ?? "").trim();
        if (!text) continue;
        lines.push({
          text,
          y: yOffset + (((line.bbox?.y0 ?? 0) + (line.bbox?.y1 ?? 0)) / 2) / scale,
          x: (line.bbox?.x0 ?? 0) / scale,
          confidence: line.confidence ?? 0,
        });
      }
    }
  }
  return lines;
}

function normalizedWords(text: string): string[] {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean))];
}

function overlapScore(a: string, b: string): number {
  const aw = normalizedWords(a);
  const bw = normalizedWords(b);
  if (!aw.length || !bw.length) return 0;
  const bset = new Set(bw);
  const common = aw.filter((w) => bset.has(w)).length;
  return common / new Set([...aw, ...bw]).size;
}

/** Merge duplicate OCR lines from the full-page and overlapping strip passes. */
function mergeOcrLines(lines: OcrLine[]): string {
  const ordered = lines
    .filter((line) => line.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const merged: OcrLine[] = [];
  for (const line of ordered) {
    let duplicate = -1;
    for (let i = merged.length - 1; i >= 0; i--) {
      const prior = merged[i];
      if (line.y - prior.y > 12) break;
      if (
        Math.abs(line.y - prior.y) <= 12 &&
        Math.abs(line.x - prior.x) <= 120 &&
        overlapScore(line.text, prior.text) >= 0.68
      ) {
        duplicate = i;
        break;
      }
    }
    if (duplicate === -1) {
      merged.push(line);
      continue;
    }
    const prior = merged[duplicate];
    const lineQuality = line.confidence + Math.min(line.text.length, 180) * 0.08;
    const priorQuality = prior.confidence + Math.min(prior.text.length, 180) * 0.08;
    if (lineQuality > priorQuality) merged[duplicate] = line;
  }
  return merged.sort((a, b) => a.y - b.y || a.x - b.x).map((line) => line.text).join("\n");
}

function needsFinePrintPass(text: string): boolean {
  const routeRows = text.match(/\([A-Z]{3}\)\s*(?:to|→)\s*[^\n]*?\([A-Z]{3}\)/gi)?.length ?? 0;
  if (routeRows < 1) return false;
  // Flight references are commonly printed as IATA code + number. Do not let
  // a carrier name followed by a compact clock such as "Swiss 450AM" count.
  const flightRefs = text.match(/\b[A-Z]{2}\s*\d{1,4}(?!\d|\s*[AP]\.?M\b)/g)?.length ?? 0;
  const hasFineDetails = /\b(?:Airbus|Boeing|Business|Economy|First|Premium)\b/i.test(text);
  return flightRefs < Math.min(routeRows, 2) || !hasFineDetails;
}

async function recognizeFinePrint(
  img: HTMLImageElement,
  worker: Tesseract.Worker
): Promise<OcrLine[]> {
  const bandHeight = Math.min(220, img.naturalHeight);
  const step = Math.max(140, Math.ceil(Math.max(0, img.naturalHeight - bandHeight) / 8));
  const lines: OcrLine[] = [];
  suppressProgress = true;
  try {
    for (let top = 0; top < img.naturalHeight; top += step) {
      const height = Math.min(bandHeight, img.naturalHeight - top);
      if (height < 60) break;
      const { canvas, scale } = prepareDetailStrip(img, top, height);
      const { data } = await worker.recognize(canvas, {}, { blocks: true });
      // Discard obvious icon/edge noise from cropped strips; carrier and
      // aircraft/cabin text is typically much more confident than these marks.
      lines.push(...linesFromBlocks(data as OcrBlockData, top, scale).filter((line) => line.confidence >= 35));
    }
  } finally {
    suppressProgress = false;
  }
  return lines;
}

export type OcrProgress = (percent: number) => void;

export async function ocrImage(
  imageSrc: string | File,
  onProgress?: OcrProgress
): Promise<string> {
  progressCb = onProgress ?? null;
  try {
    const img = await loadImage(imageSrc);
    const { canvas, scale } = prepareCanvas(img);
    const worker = await getWorker();
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const lines = linesFromBlocks(data as OcrBlockData, 0, scale);
    let text = data.text || "";

    // Full-page layout OCR can merge a route/time line but miss the faint
    // flight-number/equipment/class line beneath it. Re-read overlapping
    // horizontal strips only when the whole-page result looks incomplete.
    if (needsFinePrintPass(text)) {
      const detailLines = await recognizeFinePrint(img, worker);
      if (detailLines.length) text = mergeOcrLines([...lines, ...detailLines]);
    }
    return ocrCleanText(text);
  } finally {
    suppressProgress = false;
    progressCb = null;
  }
}

export async function resetOcrWorker(): Promise<void> {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch {
      /* ignore */
    }
    workerPromise = null;
  }
}
