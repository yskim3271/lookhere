import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchElements } from "../../shared/mapping.js";
import { hierarchyToElements, parseBounds, parseHierarchy } from "./hierarchy.js";

// Settings home on a Pixel 8 emulator (API 35), dumped with `uiautomator dump /dev/tty`.
const xml = readFileSync(new URL("../../../test/fixtures/android/settings-home.xml", import.meta.url), "utf8");

describe("parseHierarchy", () => {
  it("builds the node tree and ignores adb's trailing message", () => {
    const h = parseHierarchy(xml + "UI hierchary dumped to: /dev/tty\n");
    expect(h.rotation).toBe(0);
    expect(h.roots).toHaveLength(1);
    let count = 0;
    const walk = (ns: typeof h.roots) => ns.forEach((n) => (count++, walk(n.children)));
    walk(h.roots);
    expect(count).toBe(64);
  });

  it("unescapes attribute entities", () => {
    const h = parseHierarchy(
      `<hierarchy rotation="1"><node text="Network &amp; internet" content-desc="a&#10;b" bounds="[0,0][10,10]" /></hierarchy>`,
    );
    expect(h.rotation).toBe(1);
    expect(h.roots[0].attrs.text).toBe("Network & internet");
    expect(h.roots[0].attrs["content-desc"]).toBe("a\nb");
  });

  it("rejects input that is not a dump", () => {
    expect(() => parseHierarchy("ERROR: null root node returned by UiTestAutomationBridge.")).toThrow(/uiautomator/);
  });
});

describe("parseBounds", () => {
  it("converts [l,t][r,b] to a rect", () => {
    expect(parseBounds("[63,405][408,532]")).toEqual({ x: 63, y: 405, w: 345, h: 127 });
    expect(parseBounds("nope")).toBeNull();
  });
});

describe("hierarchyToElements", () => {
  const elements = hierarchyToElements(parseHierarchy(xml));

  it("keeps resource ids, classes, and text in screen pixels", () => {
    const title = elements.find((e) => e.id === "com.android.settings:id/homepage_title");
    expect(title).toMatchObject({
      platform: "android",
      tag: "TextView",
      className: "android.widget.TextView",
      package: "com.android.settings",
      text: "Settings",
      rect: { x: 63, y: 405, w: 345, h: 127 },
      selector: "com.android.settings:id/homepage_title",
    });
  });

  it("gives repeated ids a path selector instead of an ambiguous id", () => {
    const titles = elements.filter((e) => e.id === "android:id/title");
    expect(titles.length).toBeGreaterThan(1);
    const selectors = new Set(titles.map((t) => t.selector));
    expect(selectors.size).toBe(titles.length);
    for (const s of selectors) expect(s).not.toBe("android:id/title");
  });

  it("lets a box drawn over a row find that row's title", () => {
    // "Network & internet" title is at [189,828][625,899]; the user boxes the text loosely.
    const matches = matchElements({ x: 180, y: 820, w: 455, h: 90 }, elements);
    expect(matches[0].element.text).toBe("Network & internet");
    expect(matches[0].relation).toBe("matches");
    // A wrapping row carries the text of its children, so the agent sees what the row is.
    expect(matches.some((m) => m.element.text?.startsWith("Network & internet Mobile"))).toBe(true);
  });
});
