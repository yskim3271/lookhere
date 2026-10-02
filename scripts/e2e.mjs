// End-to-end check of the annotator in a real browser (Chrome or Edge, headless):
// screen share -> capture frame -> draw a box -> write a note -> send -> bundle on disk.
//
// Screen sharing is made non-interactive with Chromium flags that auto-pick a tab by title.
// Run after `npm run build`:  npm run e2e

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { startServer } from "../dist/server/http.js";
import { Store } from "../dist/server/store.js";

const TARGET_TITLE = "lookhere e2e target";

async function launch() {
  const args = [`--auto-select-tab-capture-source-by-title=${TARGET_TITLE}`, "--use-fake-ui-for-media-stream"];
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      return await chromium.launch({ channel, headless: true, args });
    } catch {
      // try the next browser
    }
  }
  throw new Error("Chrome or Edge is required for the e2e test");
}

const dir = await mkdtemp(path.join(tmpdir(), "lookhere-e2e-"));
const store = new Store(dir);
const server = await startServer(store, 0);
const browser = await launch();
const step = (msg) => console.log(`  ✓ ${msg}`);

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const target = await ctx.newPage();
  await target.setContent(`<title>${TARGET_TITLE}</title><body style="background:#0a7;margin:0"><h1 style="font:64px sans-serif;color:#fff;padding:40px">Shared app</h1></body>`);

  const ui = await ctx.newPage();
  await ui.goto(server.url);
  await ui.getByRole("button", { name: "Share screen" }).click();
  await ui.getByRole("button", { name: "Capture frame" }).waitFor({ timeout: 10_000 });
  // Give the video a moment to receive its first frame.
  await ui.waitForFunction(() => (document.querySelector(".share video")?.videoWidth ?? 0) > 0, null, { timeout: 10_000 });
  await ui.getByRole("button", { name: "Capture frame" }).click();
  await ui.locator(".thumb").first().waitFor({ timeout: 10_000 });
  const drafts = await store.listDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].source.kind, "screen");
  step(`screen share frame captured (${drafts[0].image.width}×${drafts[0].image.height})`);

  await ui.getByRole("button", { name: "Stop sharing" }).first().click();
  const svg = ui.locator(".stage-inner svg");
  const box = await svg.boundingBox();
  assert.ok(box, "annotator canvas is visible");
  await ui.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await ui.mouse.down();
  await ui.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.3, { steps: 5 });
  await ui.mouse.up();
  await ui.locator(".box-item textarea").first().fill("Make the heading smaller");
  step("box drawn and note written");

  await ui.getByRole("button", { name: /^Send 1 screen/ }).click();
  await ui.locator(".sent").waitFor({ timeout: 10_000 });
  const [bundle] = await store.listBundles("pending");
  assert.ok(bundle, "a pending bundle exists");
  assert.equal(bundle.boxes, 1);
  const md = await store.getBundleMarkdown(bundle.id);
  assert.match(md, /### 1\.1 Make the heading smaller/);
  assert.match(md, /Captured by: screen/);
  const crop = await readFile(store.bundleFile(bundle.id, "screen-1-box-1.png"));
  assert.ok(crop.length > 100, "crop image written");
  step(`bundle ${bundle.id} written with markdown and crop`);
  console.log("e2e passed");
} finally {
  await browser.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
}
