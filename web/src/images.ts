import type { Capture } from "../../src/shared/types";

export const MARK_COLOR = "#ff2d78";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read that image"));
    img.src = src;
  });
}

/** Any browser-readable image (PNG, JPEG, WebP, ...) to a PNG data URL. */
export async function blobToPngDataUrl(blob: Blob): Promise<string> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")!.drawImage(img, 0, 0);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Size of marks drawn into exported images, relative to the screenshot. */
function markScale(width: number): number {
  return Math.max(1, width / 1000);
}

export const BADGE_R = 13;

/** Badge sits on the box's top-left corner, nudged inward so it is never cut off at the image edge. */
export function badgePosition(rect: { x: number; y: number }, r: number, width: number, height: number) {
  return { x: Math.min(Math.max(rect.x, r), width - r), y: Math.min(Math.max(rect.y, r), height - r) };
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, label: string, s: number): void {
  const r = BADGE_R * s;
  ctx.fillStyle = MARK_COLOR;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `600 ${14 * s}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + 0.5 * s);
}

function strokeBox(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, s: number): void {
  // White halo under the colored stroke keeps the box visible on any background.
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 6 * s;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = MARK_COLOR;
  ctx.lineWidth = 3 * s;
  ctx.strokeRect(x, y, w, h);
}

/** The full screenshot with numbered boxes, plus one padded crop per box, as PNG data URLs. */
export async function renderCapture(capture: Capture): Promise<{ annotated: string; crops: Record<string, string> }> {
  const img = await loadImage(`/api/drafts/${capture.id}/image`);
  const { width, height } = capture.image;
  const s = markScale(width);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  capture.boxes.forEach((b) => strokeBox(ctx, b.rect.x, b.rect.y, b.rect.w, b.rect.h, s));
  capture.boxes.forEach((b, i) => {
    const p = badgePosition(b.rect, BADGE_R * s, width, height);
    drawBadge(ctx, p.x, p.y, String(i + 1), s);
  });
  const annotated = canvas.toDataURL("image/png");

  const crops: Record<string, string> = {};
  for (const b of capture.boxes) {
    const pad = Math.round(24 * s);
    const x = Math.max(0, b.rect.x - pad);
    const y = Math.max(0, b.rect.y - pad);
    const w = Math.min(width, b.rect.x + b.rect.w + pad) - x;
    const h = Math.min(height, b.rect.y + b.rect.h + pad) - y;
    const c = document.createElement("canvas");
    c.width = Math.max(1, w);
    c.height = Math.max(1, h);
    const cx = c.getContext("2d")!;
    cx.drawImage(img, x, y, w, h, 0, 0, w, h);
    strokeBox(cx, b.rect.x - x, b.rect.y - y, b.rect.w, b.rect.h, Math.min(s, 1.5));
    crops[b.id] = c.toDataURL("image/png");
  }
  return { annotated, crops };
}
