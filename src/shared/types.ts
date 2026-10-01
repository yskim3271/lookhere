// Shared data model. Everything here is plain JSON so the UI, the HTTP server,
// the MCP server and the files in `.lookhere/` all speak the same shapes.

/** A rectangle in image pixels (origin top-left of the captured image). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One element of the captured page, as seen at capture time. */
export interface ElementInfo {
  selector: string;
  tag: string;
  rect: Rect;
  text?: string;
  id?: string;
  classes?: string[];
  role?: string;
  label?: string;
  /** Framework component chain, innermost first, e.g. ["NavButton", "Header"]. */
  components?: string[];
  /** Source location when the framework exposes it in dev builds, e.g. "src/Header.tsx:42". */
  source?: string;
}

export type CaptureKind = "paste" | "file" | "screen" | "url";

export interface CaptureSource {
  kind: CaptureKind;
  /** Page URL for `url` captures. */
  url?: string;
  /** Page title, window title, or file name. */
  title?: string;
  /** Viewport used for `url` captures, in CSS pixels. */
  viewport?: { width: number; height: number; deviceScaleFactor: number };
}

export interface Box {
  id: string;
  rect: Rect;
  note: string;
}

/** A capture the user is still annotating (lives in `.lookhere/drafts/<id>/`). */
export interface Capture {
  id: string;
  createdAt: string;
  source: CaptureSource;
  image: { file: string; width: number; height: number };
  boxes: Box[];
  /** A note about the whole screen, not tied to a box. */
  note: string;
  /** Present for `url` captures: the page's elements, in image pixels. */
  elements?: ElementInfo[];
}

export type MatchRelation = "matches" | "contains-box" | "inside-box" | "overlaps";

export interface ElementMatch {
  element: Omit<ElementInfo, "rect"> & { rect: Rect };
  relation: MatchRelation;
  /** Intersection over union between the box and the element, 0..1. */
  iou: number;
}

export interface BundleBox {
  n: number;
  rect: Rect;
  note: string;
  /** Crop file name inside the bundle folder. */
  crop: string;
  targets: ElementMatch[];
}

export interface BundleCapture {
  n: number;
  captureId: string;
  source: CaptureSource;
  width: number;
  height: number;
  /** Full screenshot with numbered boxes drawn on it. */
  image: string;
  note: string;
  boxes: BundleBox[];
}

export type BundleStatus = "pending" | "delivered" | "done";

/** What the user sent to the agent (lives in `.lookhere/inbox/<id>/`). */
export interface Bundle {
  id: string;
  createdAt: string;
  message: string;
  captures: BundleCapture[];
}
