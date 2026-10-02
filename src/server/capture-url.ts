import type { Browser } from "playwright-core";
import type { CaptureSource, ElementInfo } from "../shared/types.js";
import { loadSourceMap, originalPosition, type RawSourceMap } from "./sourcemap.js";

export interface UrlCaptureOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  /** Extra wait after load, for pages that animate in. */
  waitMs?: number;
  /** Used to show source files relative to the project. */
  projectDir?: string;
}

type StackLoc = { url: string; line: number; column: number };
type CollectedElement = ElementInfo & { loc?: StackLoc };

/**
 * Replaces approximate `file:~line` sources (from React's dev stacks) with the original
 * file and line, using the dev server's source maps. Drops the temporary `loc` field.
 */
async function resolveSources(elements: CollectedElement[], fetchText: (url: string) => Promise<string>, projectDir?: string) {
  const maps = new Map<string, Promise<RawSourceMap | null>>();
  const mapFor = (url: string) => {
    if (!maps.has(url)) {
      maps.set(url, fetchText(url).then((code) => loadSourceMap(code, url, fetchText), () => null));
    }
    return maps.get(url)!;
  };
  for (const el of elements) {
    const loc = el.loc;
    delete el.loc;
    if (!loc) continue;
    const map = await mapFor(loc.url);
    const pos = map ? originalPosition(map, loc.line, loc.column) : null;
    if (pos) el.source = `${displayPath(pos.source, loc.url, projectDir)}:${pos.line}`;
  }
}

/**
 * Source paths in maps are either file-system paths (shown relative to the project when
 * possible) or relative to the module URL, e.g. "App.jsx" next to "/src/App.jsx".
 */
export function displayPath(source: string, moduleUrl: string, projectDir?: string): string {
  const isFsPath = /^file:\/\//.test(source) || /^[A-Za-z]:[\\/]/.test(source);
  if (!isFsPath) {
    try {
      return decodeURIComponent(new URL(source, moduleUrl).pathname).replace(/^\//, "");
    } catch {
      return source;
    }
  }
  // file:///home/x -> /home/x, file:///C:/x -> C:/x
  const clean = source.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1").replace(/\\/g, "/");
  if (projectDir) {
    const root = projectDir.replace(/\\/g, "/").replace(/\/$/, "") + "/";
    if (clean.toLowerCase().startsWith(root.toLowerCase())) return clean.slice(root.length);
  }
  return clean.replace(/^\//, "");
}

export interface UrlCapture {
  png: Buffer;
  source: CaptureSource;
  elements: ElementInfo[];
}

/**
 * Uses a browser the user already has (Chrome, then Edge) so nothing large has to be
 * downloaded. Falls back to Playwright's own Chromium if it was installed separately.
 */
async function launch(): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const errors: string[] = [];
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (e) {
      errors.push(`${channel ?? "chromium"}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  throw new Error(
    "URL capture needs Chrome or Edge installed (or run `npx playwright install chromium`).\n" + errors.join("\n"),
  );
}

export async function captureUrl(opts: UrlCaptureOptions): Promise<UrlCapture> {
  const width = opts.width ?? 1280;
  const height = opts.height ?? 800;
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.goto(opts.url, { waitUntil: "load", timeout: 30_000 });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    if (opts.waitMs) await page.waitForTimeout(opts.waitMs);

    const fullPage = opts.fullPage ?? false;
    const elements = (await page.evaluate(collectElements, { fullPage })) as CollectedElement[];
    await resolveSources(elements, (u) => page.evaluate((x) => fetch(x).then((r) => r.text()), u), opts.projectDir);
    const png = await page.screenshot({ fullPage, type: "png" });
    return {
      png,
      elements,
      source: {
        kind: "url",
        url: page.url(),
        title: await page.title(),
        viewport: { width, height, deviceScaleFactor: 1 },
      },
    };
  } finally {
    await browser.close();
  }
}

/**
 * Runs inside the page. Must be self-contained: Playwright serializes it as source.
 * Coordinates are CSS pixels, which equal image pixels at deviceScaleFactor 1.
 */
function collectElements({ fullPage }: { fullPage: boolean }): CollectedElement[] {
  const MAX = 4000;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "META", "LINK", "HEAD", "BR", "WBR"]);
  const offX = fullPage ? window.scrollX : 0;
  const offY = fullPage ? window.scrollY : 0;
  const pageW = fullPage ? document.documentElement.scrollWidth : window.innerWidth;
  const pageH = fullPage ? document.documentElement.scrollHeight : window.innerHeight;
  const looksGenerated = (c: string) => /\d{3,}|^css-|^sc-|^_|[A-Za-z0-9]{8,}_/.test(c) || c.length > 40;

  const cssEscape = (s: string) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\$&"));

  function selectorFor(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && node.nodeType === 1 && parts.length < 5) {
      if (node.id && document.querySelectorAll(`#${cssEscape(node.id)}`).length === 1) {
        parts.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const testId = node.getAttribute("data-testid");
      if (testId) {
        part += `[data-testid="${testId}"]`;
      } else {
        const classes = Array.from(node.classList).filter((c) => !looksGenerated(c)).slice(0, 2);
        if (classes.length) part += "." + classes.map(cssEscape).join(".");
        const parent: Element | null = node.parentElement;
        if (parent) {
          const same = Array.from(parent.children).filter((s) => s.tagName === node!.tagName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      if (node.tagName === "BODY") break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // React 19 dev builds keep the stack of the JSX call instead of `_debugSource`. The first
  // frame outside dependencies is the component file. Its line is from the transformed module,
  // so "~" marks it as approximate until the Node side maps `stackLoc` through the source map.
  let stackLoc: StackLoc | undefined;
  function sourceFromStack(stack: string): string | undefined {
    for (const line of stack.split("\n").slice(1)) {
      const m = /((?:https?|file):\/\/[^\s()]+):(\d+):(\d+)\)?\s*$/.exec(line);
      if (!m || /node_modules|\/@fs\/|\/\.vite\/|\/@vite\/|\/@react-refresh/.test(m[1])) continue;
      try {
        const path = decodeURIComponent(new URL(m[1]).pathname).replace(/^\//, "");
        stackLoc = { url: m[1], line: Number(m[2]), column: Number(m[3]) };
        return `${path}:~${m[2]}`;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  // First ~80 characters of visible text, with a space between separate text nodes so
  // adjacent links read "Features Pricing" rather than "FeaturesPricing".
  function shortText(el: Element): string {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    let length = 0;
    for (let n = walker.nextNode(); n && length < 80; n = walker.nextNode()) {
      const t = (n.nodeValue || "").replace(/\s+/g, " ").trim();
      const parent = n.parentElement;
      if (!t || (parent && SKIP.has(parent.tagName))) continue;
      parts.push(t);
      length += t.length + 1;
    }
    return parts.join(" ").slice(0, 80);
  }

  // Framework component names and dev-only source locations.
  function frameworkInfo(el: Element): { components?: string[]; source?: string } {
    const anyEl = el as unknown as Record<string, any>;
    const fiberKey = Object.keys(anyEl).find((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"));
    if (fiberKey) {
      const names: string[] = [];
      let source: string | undefined;
      let f = anyEl[fiberKey];
      while (f && names.length < 4) {
        const t = f.type;
        if (typeof t === "function" || (t && typeof t === "object" && (t.render || t.type))) {
          const name = t.displayName || t.name || t.render?.displayName || t.render?.name || t.type?.name;
          if (name && !names.includes(name)) names.push(name);
        }
        if (!source && f._debugSource?.fileName) source = `${f._debugSource.fileName}:${f._debugSource.lineNumber}`;
        if (!source && f._debugStack?.stack) source = sourceFromStack(String(f._debugStack.stack));
        f = f.return;
      }
      return { components: names.length ? names : undefined, source };
    }
    const vue = anyEl.__vueParentComponent;
    if (vue) {
      const names: string[] = [];
      let source: string | undefined;
      let c = vue;
      while (c && names.length < 4) {
        const name = c.type?.name || c.type?.__name;
        if (name) names.push(name);
        if (!source && c.type?.__file) source = c.type.__file;
        c = c.parent;
      }
      return { components: names.length ? names : undefined, source };
    }
    const svelte = anyEl.__svelte_meta;
    if (svelte?.loc) return { source: `${svelte.loc.file}:${svelte.loc.line}` };
    return {};
  }

  const out: CollectedElement[] = [];
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (const el of Array.from(all)) {
    if (out.length >= MAX) break;
    if (SKIP.has(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const x = r.left + offX;
    const y = r.top + offY;
    if (x + r.width <= 0 || y + r.height <= 0 || x >= pageW || y >= pageH) continue;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;

    const text = shortText(el);
    stackLoc = undefined;
    const info: CollectedElement = {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      rect: { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) },
      ...frameworkInfo(el),
    };
    if (stackLoc) info.loc = stackLoc;
    if (text) info.text = text;
    if (el.id) info.id = el.id;
    if (el.classList.length) info.classes = Array.from(el.classList).slice(0, 6);
    const role = el.getAttribute("role");
    if (role) info.role = role;
    const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title");
    if (label) info.label = label.slice(0, 80);
    out.push(info);
  }
  return out;
}
