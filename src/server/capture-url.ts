import type { Browser } from "playwright-core";
import type { CaptureSource, ElementInfo } from "../shared/types.js";

export interface UrlCaptureOptions {
  url: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  /** Extra wait after load, for pages that animate in. */
  waitMs?: number;
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
    const elements = (await page.evaluate(collectElements, { fullPage })) as ElementInfo[];
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
function collectElements({ fullPage }: { fullPage: boolean }): ElementInfo[] {
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

  const out: ElementInfo[] = [];
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

    // innerText keeps the spaces between inline children ("Features Pricing"), textContent does not.
    const raw = el instanceof HTMLElement ? el.innerText : el.textContent;
    const text = (raw || "").replace(/\s+/g, " ").trim().slice(0, 80);
    const info: ElementInfo = {
      selector: selectorFor(el),
      tag: el.tagName.toLowerCase(),
      rect: { x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height) },
      ...frameworkInfo(el),
    };
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
