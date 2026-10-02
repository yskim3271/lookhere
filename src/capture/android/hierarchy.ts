import type { ElementInfo, Rect } from "../../shared/types.js";

/** One `<node>` of a `uiautomator dump`, with its children. */
export interface UiNode {
  attrs: Record<string, string>;
  children: UiNode[];
  parent?: UiNode;
}

export interface Hierarchy {
  rotation: number;
  roots: UiNode[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e[0] !== "#") return ENTITIES[e];
    const code = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of src.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attrs[m[1]] = unescapeXml(m[2] ?? m[3] ?? "");
  }
  return attrs;
}

/**
 * Parses `uiautomator dump` output. The format is flat and machine-written
 * (`<hierarchy>` with nested `<node .../>`), so a tag scanner is enough; no XML library.
 * Text after the closing `</hierarchy>` (adb's "UI hierchary dumped to" line) is ignored.
 */
export function parseHierarchy(xml: string): Hierarchy {
  const start = xml.indexOf("<hierarchy");
  if (start < 0) throw new Error("Not a uiautomator dump: no <hierarchy> element");
  const end = xml.indexOf("</hierarchy>", start);
  const body = xml.slice(start, end < 0 ? undefined : end + "</hierarchy>".length);

  const hierarchy: Hierarchy = { rotation: 0, roots: [] };
  const stack: UiNode[] = [];
  for (const m of body.matchAll(/<(\/?)(hierarchy|node)\b([^>]*?)(\/?)>/g)) {
    const [, closing, tag, rawAttrs, selfClosing] = m;
    if (tag === "hierarchy") {
      if (!closing) hierarchy.rotation = Number(parseAttrs(rawAttrs).rotation ?? 0);
      continue;
    }
    if (closing) {
      stack.pop();
      continue;
    }
    const parent = stack[stack.length - 1];
    const node: UiNode = { attrs: parseAttrs(rawAttrs), children: [], parent };
    if (parent) parent.children.push(node);
    else hierarchy.roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  return hierarchy;
}

/** "[63,405][408,532]" -> { x: 63, y: 405, w: 345, h: 127 } */
export function parseBounds(bounds: string | undefined): Rect | null {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds ?? "");
  if (!m) return null;
  const [l, t, r, b] = m.slice(1).map(Number);
  return { x: l, y: t, w: r - l, h: b - t };
}

function shortClass(cls: string | undefined): string {
  return (cls ?? "View").split(".").pop() || "View";
}

function walk(nodes: UiNode[], visit: (n: UiNode) => void): void {
  for (const n of nodes) {
    visit(n);
    walk(n.children, visit);
  }
}

/** Visible text of a node: its own text or content-desc, else its descendants' (first ~80 chars). */
function nodeText(n: UiNode): string {
  const own = n.attrs.text || n.attrs["content-desc"];
  if (own) return own.replace(/\s+/g, " ").trim().slice(0, 80);
  const parts: string[] = [];
  let length = 0;
  walk(n.children, (c) => {
    const t = (c.attrs.text || c.attrs["content-desc"] || "").replace(/\s+/g, " ").trim();
    if (t && length < 80) {
      parts.push(t);
      length += t.length + 1;
    }
  });
  return parts.join(" ").slice(0, 80);
}

/**
 * A readable locator: the resource-id when it is unique on screen, otherwise a short path
 * of class names from the nearest ancestor that has a unique resource-id,
 * e.g. `com.android.settings:id/recycler_view > LinearLayout[3] > TextView`.
 */
function selectorFor(n: UiNode, idCounts: Map<string, number>): string {
  const parts: string[] = [];
  let node: UiNode | undefined = n;
  while (node && parts.length < 5) {
    const id = node.attrs["resource-id"];
    if (id && idCounts.get(id) === 1) {
      parts.unshift(id);
      break;
    }
    let part = shortClass(node.attrs.class);
    const siblings = node.parent ? node.parent.children : [];
    const same = siblings.filter((s) => s.attrs.class === node!.attrs.class);
    if (same.length > 1) part += `[${same.indexOf(node) + 1}]`;
    if (id) part += `#${id.split("/").pop()}`;
    parts.unshift(part);
    node = node.parent;
  }
  return parts.join(" > ");
}

/**
 * Converts a hierarchy into the shared ElementInfo list. Bounds are screen pixels, the same
 * coordinate space as `screencap`, so the web box matcher works unchanged.
 */
export function hierarchyToElements(h: Hierarchy, screen?: { width: number; height: number }): ElementInfo[] {
  const idCounts = new Map<string, number>();
  walk(h.roots, (n) => {
    const id = n.attrs["resource-id"];
    if (id) idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  });

  const out: ElementInfo[] = [];
  walk(h.roots, (n) => {
    const rect = parseBounds(n.attrs.bounds);
    if (!rect || rect.w < 2 || rect.h < 2) return;
    if (screen && (rect.x >= screen.width || rect.y >= screen.height || rect.x + rect.w <= 0 || rect.y + rect.h <= 0)) return;

    const info: ElementInfo = {
      platform: "android",
      selector: selectorFor(n, idCounts),
      tag: shortClass(n.attrs.class),
      rect,
    };
    const text = nodeText(n);
    if (text) info.text = text;
    if (text && !(n.attrs.text || n.attrs["content-desc"])) info.textFromChildren = true;
    if (n.attrs["resource-id"]) info.id = n.attrs["resource-id"];
    if (n.attrs.class) info.className = n.attrs.class;
    if (n.attrs.package) info.package = n.attrs.package;
    if (n.attrs["content-desc"]) info.label = n.attrs["content-desc"].slice(0, 80);
    if (n.attrs.clickable === "true") info.role = "clickable";
    out.push(info);
  });
  return out;
}
