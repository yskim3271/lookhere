import { describe, expect, it } from "vitest";
import { decodeVlq, loadSourceMap, originalPosition } from "./sourcemap.js";

describe("decodeVlq", () => {
  it("decodes known segments", () => {
    expect(decodeVlq("AAAA")).toEqual([0, 0, 0, 0]);
    expect(decodeVlq("AACA")).toEqual([0, 0, 1, 0]);
    expect(decodeVlq("D")).toEqual([-1]);
    expect(decodeVlq("gB")).toEqual([16]);
  });
});

describe("originalPosition", () => {
  // Generated line 1 maps to src line 1; generated line 3, col 0 -> src line 2; col 10 -> src line 5.
  const map = { sources: ["src/App.jsx"], mappings: "AAAA;;AACA,UAGA" };

  it("maps a generated line and column back to the original line", () => {
    expect(originalPosition(map, 1, 1)).toEqual({ source: "src/App.jsx", line: 1 });
    expect(originalPosition(map, 3, 5)).toEqual({ source: "src/App.jsx", line: 2 });
    expect(originalPosition(map, 3, 12)).toEqual({ source: "src/App.jsx", line: 5 });
  });

  it("returns null for unmapped lines", () => {
    expect(originalPosition(map, 2, 1)).toBeNull();
  });
});

describe("loadSourceMap", () => {
  it("reads inline base64 maps", async () => {
    const json = JSON.stringify({ sources: ["a.js"], mappings: "AAAA" });
    const code = `x()\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(json).toString("base64")}\n`;
    expect(await loadSourceMap(code, "http://localhost/a.js", async () => "")).toEqual(JSON.parse(json));
  });

  it("fetches external maps relative to the module", async () => {
    const seen: string[] = [];
    const map = await loadSourceMap("x()\n//# sourceMappingURL=a.js.map", "http://localhost/src/a.js", async (u) => {
      seen.push(u);
      return '{"sources":[],"mappings":""}';
    });
    expect(seen).toEqual(["http://localhost/src/a.js.map"]);
    expect(map?.mappings).toBe("");
  });
});

describe("displayPath", async () => {
  const { displayPath } = await import("./capture-url.js");
  it("resolves map-relative sources against the module URL", () => {
    expect(displayPath("App.jsx", "http://localhost:5174/src/App.jsx?t=1")).toBe("src/App.jsx");
  });
  it("shows absolute paths relative to the project", () => {
    expect(displayPath(String.raw`C:\work\app\src\App.tsx`, "http://x/src/App.tsx", String.raw`C:\work\app`)).toBe("src/App.tsx");
    expect(displayPath("file:///home/me/app/src/App.tsx", "http://x/", "/home/me/app")).toBe("src/App.tsx");
  });
});
