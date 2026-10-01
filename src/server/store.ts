import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { clampRect, matchElements } from "../shared/mapping.js";
import { renderBundleMarkdown } from "../shared/markdown.js";
import type { Box, Bundle, BundleStatus, Capture, CaptureSource, ElementInfo } from "../shared/types.js";

let lastIdTime = 0;

/** Sortable id (`20261002-083012345-ab12`): time first so sorted order is creation order. */
export function newId(): string {
  lastIdTime = Math.max(Date.now(), lastIdTime + 1);
  const d = new Date(lastIdTime);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const t =
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${pad(d.getMilliseconds(), 3)}`;
  return `${t.slice(0, 8)}-${t.slice(8)}-${randomBytes(2).toString("hex")}`;
}

/** Reads width/height from a PNG header. Throws on anything that is not a PNG. */
export function pngSize(png: Buffer): { width: number; height: number } {
  const sig = "89504e470d0a1a0a";
  if (png.length < 24 || png.subarray(0, 8).toString("hex") !== sig) throw new Error("Image must be a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function decodeDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Expected a data:image/png;base64 URL");
  return Buffer.from(m[1], "base64");
}

export interface SendItem {
  captureId: string;
  /** Full screenshot with numbered boxes drawn on it (PNG). */
  annotated: Buffer;
  /** Crop per box id (PNG). */
  crops: Record<string, Buffer>;
}

export interface BundleSummary {
  id: string;
  createdAt: string;
  status: BundleStatus;
  captures: number;
  boxes: number;
  message: string;
}

/** All state lives in `<projectDir>/.lookhere/` so separate processes share it. */
export class Store {
  readonly root: string;
  readonly draftsDir: string;
  readonly inboxDir: string;
  /** Port of the UI server currently serving this project. */
  readonly serverFile: string;

  constructor(readonly projectDir: string) {
    this.root = path.join(projectDir, ".lookhere");
    this.draftsDir = path.join(this.root, "drafts");
    this.inboxDir = path.join(this.root, "inbox");
    this.serverFile = path.join(this.root, "server.json");
  }

  async init(): Promise<void> {
    await mkdir(this.draftsDir, { recursive: true });
    await mkdir(this.inboxDir, { recursive: true });
    const ignore = path.join(this.root, ".gitignore");
    if (!existsSync(ignore)) await writeFile(ignore, "*\n");
  }

  /** Path of a bundle folder as an agent should cite it: relative to the project, forward slashes. */
  bundleDirForAgent(id: string): string {
    return path.relative(this.projectDir, path.join(this.inboxDir, id)).split(path.sep).join("/");
  }

  // ---------- drafts ----------

  async createDraft(png: Buffer, source: CaptureSource, elements?: ElementInfo[]): Promise<Capture> {
    const { width, height } = pngSize(png);
    const id = newId();
    const dir = path.join(this.draftsDir, id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "image.png"), png);
    const capture: Capture = {
      id,
      createdAt: new Date().toISOString(),
      source,
      image: { file: "image.png", width, height },
      boxes: [],
      note: "",
      ...(elements ? { elements } : {}),
    };
    await this.writeDraft(capture);
    return capture;
  }

  async listDrafts(): Promise<Capture[]> {
    const ids = await this.dirs(this.draftsDir);
    const drafts = await Promise.all(ids.map((id) => this.getDraft(id).catch(() => null)));
    return drafts.filter((d): d is Capture => d !== null);
  }

  async getDraft(id: string): Promise<Capture> {
    const raw = await readFile(path.join(this.draftDir(id), "capture.json"), "utf8");
    return JSON.parse(raw) as Capture;
  }

  draftImagePath(id: string): string {
    return path.join(this.draftDir(id), "image.png");
  }

  async updateDraft(id: string, patch: { boxes?: Box[]; note?: string }): Promise<Capture> {
    const c = await this.getDraft(id);
    if (patch.boxes) {
      c.boxes = patch.boxes.map((b) => ({
        id: String(b.id),
        note: String(b.note ?? ""),
        rect: clampRect(b.rect, c.image.width, c.image.height),
      }));
    }
    if (typeof patch.note === "string") c.note = patch.note;
    await this.writeDraft(c);
    return c;
  }

  async deleteDraft(id: string): Promise<void> {
    await rm(this.draftDir(id), { recursive: true, force: true });
  }

  // ---------- inbox ----------

  /** Turns drafts into one bundle in the inbox and removes those drafts. */
  async send(items: SendItem[], message: string): Promise<Bundle> {
    if (items.length === 0) throw new Error("Nothing to send");
    const id = newId();
    const dir = path.join(this.inboxDir, id);
    await mkdir(dir, { recursive: true });

    const bundle: Bundle = { id, createdAt: new Date().toISOString(), message, captures: [] };
    for (const [i, item] of items.entries()) {
      const c = await this.getDraft(item.captureId);
      const n = i + 1;
      const image = `screen-${n}.png`;
      await writeFile(path.join(dir, image), item.annotated);
      // The original, unannotated screenshot is useful when boxes cover details.
      await writeFile(path.join(dir, `screen-${n}-original.png`), await readFile(this.draftImagePath(c.id)));

      const boxes = [];
      for (const [j, b] of c.boxes.entries()) {
        const crop = `screen-${n}-box-${j + 1}.png`;
        const png = item.crops[b.id];
        if (png) await writeFile(path.join(dir, crop), png);
        boxes.push({
          n: j + 1,
          rect: b.rect,
          note: b.note,
          crop,
          targets: c.elements ? matchElements(b.rect, c.elements) : [],
        });
      }
      bundle.captures.push({
        n,
        captureId: c.id,
        source: c.source,
        width: c.image.width,
        height: c.image.height,
        image,
        note: c.note,
        boxes,
      });
    }

    await writeFile(path.join(dir, "feedback.json"), JSON.stringify(bundle, null, 2));
    await writeFile(path.join(dir, "feedback.md"), renderBundleMarkdown(bundle, this.bundleDirForAgent(id)));
    await this.setStatus(id, "pending");
    for (const item of items) await this.deleteDraft(item.captureId);
    return bundle;
  }

  async getBundle(id: string): Promise<Bundle> {
    return JSON.parse(await readFile(path.join(this.inboxDir, safeId(id), "feedback.json"), "utf8")) as Bundle;
  }

  async getBundleMarkdown(id: string): Promise<string> {
    return readFile(path.join(this.inboxDir, safeId(id), "feedback.md"), "utf8");
  }

  bundleFile(id: string, file: string): string {
    return path.join(this.inboxDir, safeId(id), path.basename(file));
  }

  async getStatus(id: string): Promise<BundleStatus> {
    try {
      return (await readFile(path.join(this.inboxDir, safeId(id), "status"), "utf8")).trim() as BundleStatus;
    } catch {
      return "pending";
    }
  }

  async setStatus(id: string, status: BundleStatus): Promise<void> {
    await writeFile(path.join(this.inboxDir, safeId(id), "status"), status);
  }

  async listBundles(status?: BundleStatus): Promise<BundleSummary[]> {
    const ids = await this.dirs(this.inboxDir);
    const out: BundleSummary[] = [];
    for (const id of ids) {
      const s = await this.getStatus(id);
      if (status && s !== status) continue;
      try {
        const b = await this.getBundle(id);
        out.push({
          id,
          createdAt: b.createdAt,
          status: s,
          captures: b.captures.length,
          boxes: b.captures.reduce((n, c) => n + c.boxes.length, 0),
          message: b.message,
        });
      } catch {
        // A bundle still being written; skip it this round.
      }
    }
    return out;
  }

  // ---------- helpers ----------

  private draftDir(id: string): string {
    return path.join(this.draftsDir, safeId(id));
  }

  private async writeDraft(c: Capture): Promise<void> {
    await writeFile(path.join(this.draftDir(c.id), "capture.json"), JSON.stringify(c, null, 2));
  }

  private async dirs(dir: string): Promise<string[]> {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    } catch {
      return [];
    }
  }
}

/** Ids come from URLs and tool calls; never let one escape its folder. */
export function safeId(id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}
