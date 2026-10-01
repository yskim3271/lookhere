import { describe, expect, it } from "vitest";
import { clampRect, matchElements, normalizeRect } from "./mapping.js";
import type { ElementInfo } from "./types.js";

const el = (selector: string, x: number, y: number, w: number, h: number): ElementInfo => ({
  selector,
  tag: selector.split(/[.#]/)[0] || "div",
  rect: { x, y, w, h },
});

const page: ElementInfo[] = [
  el("body", 0, 0, 1280, 800),
  el("header", 0, 0, 1280, 80),
  el("button.signup", 1100, 20, 120, 40),
  el("main", 0, 80, 1280, 720),
  el("section.card", 100, 200, 400, 300),
  el("h2.card-title", 120, 220, 200, 30),
];

describe("matchElements", () => {
  it("puts the element that fits the box first", () => {
    const m = matchElements({ x: 1095, y: 15, w: 130, h: 50 }, page);
    expect(m[0].element.selector).toBe("button.signup");
    expect(m[0].relation).toBe("matches");
  });

  it("includes the smallest wrapper for a small box inside a big element", () => {
    const m = matchElements({ x: 300, y: 400, w: 20, h: 20 }, page);
    expect(m.map((x) => x.element.selector)).toContain("section.card");
    const card = m.find((x) => x.element.selector === "section.card")!;
    expect(card.relation).toBe("contains-box");
  });

  it("marks elements fully inside a large box", () => {
    const m = matchElements({ x: 90, y: 190, w: 420, h: 320 }, page);
    expect(m[0].element.selector).toBe("section.card");
    const title = matchElements({ x: 110, y: 210, w: 260, h: 60 }, page).find((x) => x.element.selector === "h2.card-title");
    expect(title?.relation).toBe("inside-box");
  });

  it("returns at most `limit` matches and nothing for empty input", () => {
    expect(matchElements({ x: 0, y: 0, w: 1280, h: 800 }, page, 2)).toHaveLength(2);
    expect(matchElements({ x: 0, y: 0, w: 0, h: 10 }, page)).toEqual([]);
    expect(matchElements({ x: 0, y: 0, w: 10, h: 10 }, [])).toEqual([]);
  });
});

describe("rect helpers", () => {
  it("normalizes boxes drawn up-left", () => {
    expect(normalizeRect({ x: 100, y: 100, w: -40.4, h: -20.6 })).toEqual({ x: 60, y: 79, w: 40, h: 21 });
  });
  it("clamps to the image", () => {
    expect(clampRect({ x: -10, y: 790, w: 50, h: 50 }, 1280, 800)).toEqual({ x: 0, y: 790, w: 40, h: 10 });
  });
});
