import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Store, pngSize, safeId } from "./store.js";

/** Smallest valid RGBA PNG of the given size (CRCs are not checked by our reader). */
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "lookhere-"));
  store = new Store(dir);
  await store.init();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Store", () => {
  it("reads PNG size and rejects other formats", () => {
    expect(pngSize(makePng(640, 480))).toEqual({ width: 640, height: 480 });
    expect(() => pngSize(Buffer.from("GIF89a........................"))).toThrow(/PNG/);
  });

  it("rejects ids that could escape the store", () => {
    expect(() => safeId("../etc")).toThrow();
    expect(safeId("20261002-101010-ab12")).toBe("20261002-101010-ab12");
  });

  it("creates, edits, and sends drafts as one bundle", async () => {
    const a = await store.createDraft(makePng(1280, 800), { kind: "url", url: "http://localhost:3000/" }, [
      { selector: "button.signup", tag: "button", text: "Sign up", rect: { x: 1100, y: 20, w: 120, h: 40 }, components: ["NavButton", "Header"] },
    ]);
    const b = await store.createDraft(makePng(400, 300), { kind: "paste" });
    expect((await store.listDrafts()).map((d) => d.id)).toEqual([a.id, b.id]);

    await store.updateDraft(a.id, {
      boxes: [{ id: "k1", note: "Make this bigger", rect: { x: 1095, y: 15, w: 130, h: 50 } }],
      note: "Header feels cramped",
    });
    await store.updateDraft(b.id, { boxes: [{ id: "k2", note: "Wrong color", rect: { x: 350, y: 250, w: 100, h: 100 } }] });
    expect((await store.getDraft(b.id)).boxes[0].rect).toEqual({ x: 350, y: 250, w: 50, h: 50 });

    const png = makePng(10, 10);
    const bundle = await store.send(
      [
        { captureId: a.id, annotated: png, crops: { k1: png } },
        { captureId: b.id, annotated: png, crops: { k2: png } },
      ],
      "Polish the header",
    );

    expect(await store.listDrafts()).toEqual([]);
    expect(await store.listBundles("pending")).toHaveLength(1);
    expect(bundle.captures[0].boxes[0].targets[0].element.selector).toBe("button.signup");

    const md = await store.getBundleMarkdown(bundle.id);
    expect(md).toContain("Polish the header");
    expect(md).toContain("### 1.1 Make this bigger");
    expect(md).toContain("`button.signup`");
    expect(md).toContain("component `NavButton` in `Header`");
    expect(md).toContain(`.lookhere/inbox/${bundle.id}/screen-2-box-1.png`);
    await expect(readFile(store.bundleFile(bundle.id, "screen-1-original.png"))).resolves.toBeInstanceOf(Buffer);

    await store.setStatus(bundle.id, "done");
    expect(await store.listBundles("pending")).toEqual([]);
  });
});
