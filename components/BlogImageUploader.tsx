"use client";

/**
 * <BlogImageUploader /> — file-input based hero-image picker for the
 * Blog Management modal. Resizes a chosen image to fit inside a
 * 1280×720 box (16:9) and ADAPTIVELY compresses it (stepping JPEG
 * quality down, then downscaling if needed) so the emitted
 * `data:image/jpeg;base64,…` URL stays under a bounded byte budget
 * regardless of the source image. The result is handed straight to the
 * imageUrl field and persisted to the (TEXT) blogs.image_url column —
 * keeping the row, the BFF request body, and the DB lean.
 */

import { useCallback, useRef, useState } from "react";

const MAX_W = 1280;
const MAX_H = 720;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
// Defensive payload cap: keep the stored data: URL ≲ this many encoded
// bytes so a big source photo can't bloat the request/DB row.
const TARGET_BYTES = 320 * 1024;
// Quality ladder tried (best → most-compressed) before we downscale.
const QUALITY_STEPS = [0.82, 0.72, 0.62, 0.52, 0.42];

type Props = {
  value: string | null;
  onChange: (dataUrl: string) => Promise<void> | void;
  onClear?: () => Promise<void> | void;
  className?: string;
};

/** Approximate the decoded byte size of a base64 data: URL. */
function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

async function fileToResizedJpegDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  // Fit into MAX_W x MAX_H while preserving aspect ratio (never upscale).
  let scale = Math.min(MAX_W / bitmap.width, MAX_H / bitmap.height, 1);

  const render = (s: number, q: number): string => {
    const targetW = Math.max(1, Math.round(bitmap.width * s));
    const targetH = Math.max(1, Math.round(bitmap.height * s));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported in this browser.");
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    return canvas.toDataURL("image/jpeg", q);
  };

  // 1) Step JPEG quality down at the target size until under budget.
  let best = render(scale, QUALITY_STEPS[0]);
  for (let i = 1; i < QUALITY_STEPS.length && dataUrlBytes(best) > TARGET_BYTES; i++) {
    best = render(scale, QUALITY_STEPS[i]);
  }
  // 2) Still over budget at the lowest quality? Downscale the canvas and
  //    retry a few times (a hard floor of 30% keeps it usable).
  let guard = 0;
  while (dataUrlBytes(best) > TARGET_BYTES && scale > 0.3 && guard < 4) {
    scale *= 0.8;
    best = render(scale, QUALITY_STEPS[QUALITY_STEPS.length - 1]);
    guard++;
  }

  bitmap.close?.();
  return best;
}

export default function BlogImageUploader({ value, onChange, onClear, className = "" }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickFile = useCallback(() => {
    setError(null);
    fileInputRef.current?.click();
  }, []);

  async function handleFile(file: File) {
    setError(null);
    if (!ALLOWED_TYPES.includes(file.type)) {
      setError("Please choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError("Image is too large (max 10 MB before resize).");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await fileToResizedJpegDataUrl(file);
      await onChange(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't process image.");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function clear() {
    if (!onClear) return;
    setError(null);
    setBusy(true);
    try {
      await onClear();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Preview */}
      <div className="relative w-full overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-pill-bg)]">
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt="Blog hero preview"
            className="block max-h-72 w-full object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex h-40 items-center justify-center text-xs text-[var(--color-muted)]">
            No image selected
          </div>
        )}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40">
            <span className="h-5 w-5 rounded-full border-2 border-white border-t-transparent animate-spin" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {value ? "Change image" : "Upload image"}
        </button>
        {value && onClear && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={busy}
            className="inline-flex items-center rounded-full border border-[var(--color-border)] px-4 py-1.5 text-xs font-semibold text-[var(--color-muted)] transition hover:text-[var(--color-text)] disabled:opacity-50"
          >
            Remove
          </button>
        )}
        <span className="ml-1 text-[11px] text-[var(--color-muted)]">
          JPEG, PNG, or WebP. We resize to fit 1280×720 and compress before storing.
        </span>
      </div>
      {error && (
        <p className="text-[11px] font-semibold text-red-500">{error}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
