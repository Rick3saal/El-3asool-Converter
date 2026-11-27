/**
 * IMAGE / SCREENSHOT PATH — OCR via Tesseract.js running fully in the browser.
 * The recognized text then flows through the SAME deterministic parser and
 * Sabre formatter as typed text. Text is never routed through this module.
 */
import Tesseract from "tesseract.js";
import { ocrCleanText } from "./parser";

let workerPromise: Promise<Tesseract.Worker> | null = null;
let progressCb: ((p: number) => void) | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = Tesseract.createWorker("eng", 1, {
      logger: (m: Tesseract.LoggerMessage) => {
        if (m.status === "recognizing text" && progressCb) {
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

/** upscale small screenshots and boost contrast for better OCR accuracy */
function prepareCanvas(img: HTMLImageElement): HTMLCanvasElement {
  const maxW = 2200;
  // Scale both axes together. The old code enlarged only the canvas height for
  // typical screenshots, stretching letters vertically while leaving small
  // equipment / booking-class text at its original pixel width. Upscaling the
  // whole image makes those faint details legible to Tesseract without
  // distorting route rows.
  const scale = Math.min(maxW / img.naturalWidth, 2.2);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Search-card secondary details are often gray-on-charcoal. Stronger contrast
  // helps retain those cabin letters and aircraft labels in the OCR transcript.
  ctx.filter = "grayscale(1) contrast(1.7) brightness(1.12)";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export type OcrProgress = (percent: number) => void;

export async function ocrImage(
  imageSrc: string | File,
  onProgress?: OcrProgress
): Promise<string> {
  progressCb = onProgress ?? null;
  const img = await loadImage(imageSrc);
  const canvas = prepareCanvas(img);
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas);
  progressCb = null;
  return ocrCleanText(data.text || "");
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
