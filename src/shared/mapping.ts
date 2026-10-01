import type { ElementInfo, ElementMatch, MatchRelation, Rect } from "./types.js";

export function area(r: Rect): number {
  return Math.max(0, r.w) * Math.max(0, r.h);
}

export function intersection(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Normalizes a rect drawn in any direction (negative w/h) and rounds it. */
export function normalizeRect(r: Rect): Rect {
  const x = r.w < 0 ? r.x + r.w : r.x;
  const y = r.h < 0 ? r.y + r.h : r.y;
  return { x: Math.round(x), y: Math.round(y), w: Math.round(Math.abs(r.w)), h: Math.round(Math.abs(r.h)) };
}

export function clampRect(r: Rect, width: number, height: number): Rect {
  const x1 = Math.min(Math.max(0, r.x), width);
  const y1 = Math.min(Math.max(0, r.y), height);
  const x2 = Math.min(Math.max(0, r.x + r.w), width);
  const y2 = Math.min(Math.max(0, r.y + r.h), height);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Finds the page elements a user most likely meant by drawing `box`.
 *
 * The best IoU match comes first. The smallest element that fully wraps the box
 * is always included, because a small box inside a large card has a low IoU with
 * everything but still clearly points into that card.
 */
export function matchElements(box: Rect, elements: ElementInfo[], limit = 3): ElementMatch[] {
  const boxArea = area(box);
  if (boxArea === 0 || elements.length === 0) return [];

  const scored = elements
    .map((element) => {
      const elArea = area(element.rect);
      const inter = intersection(box, element.rect);
      if (elArea === 0 || inter === 0) return null;
      const iou = inter / (boxArea + elArea - inter);
      const ofBox = inter / boxArea;
      const ofEl = inter / elArea;
      return { element, elArea, iou, ofBox, ofEl };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const relation = (s: (typeof scored)[number]): MatchRelation => {
    if (s.iou >= 0.7) return "matches";
    if (s.ofBox >= 0.95) return "contains-box";
    if (s.ofEl >= 0.95) return "inside-box";
    return "overlaps";
  };

  const byIou = scored.filter((s) => s.iou >= 0.1).sort((a, b) => b.iou - a.iou || a.elArea - b.elArea);
  const wrapper = scored.filter((s) => s.ofBox >= 0.95).sort((a, b) => a.elArea - b.elArea)[0];

  const picked: typeof scored = [];
  for (const s of [...byIou.slice(0, limit), wrapper]) {
    if (s && !picked.includes(s)) picked.push(s);
  }
  if (picked.length > limit) {
    // Keep the wrapper; drop the weakest IoU match instead.
    picked.splice(limit - 1, picked.length - limit);
  }

  return picked.map((s) => ({
    element: s.element,
    relation: relation(s),
    iou: Math.round(s.iou * 100) / 100,
  }));
}
