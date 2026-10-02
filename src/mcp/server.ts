import { readFile } from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { captureUrl } from "../server/capture-url.js";
import { ensureServer } from "../server/http.js";
import type { Store } from "../server/store.js";
import { openInBrowser } from "../open.js";

type Content =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type ImageMode = "all" | "crops" | "none";

const VERSION = "0.1.0";

/** Pending bundles as MCP content: the markdown, then the images it refers to. */
async function bundlesAsContent(store: Store, ids: string[], images: ImageMode): Promise<Content[]> {
  const content: Content[] = [];
  for (const id of ids) {
    content.push({ type: "text", text: await store.getBundleMarkdown(id) });
    if (images === "none") continue;
    const bundle = await store.getBundle(id);
    for (const c of bundle.captures) {
      const files = [...(images === "all" ? [c.image] : []), ...c.boxes.map((b) => b.crop)];
      for (const file of files) {
        const data = await readFile(store.bundleFile(id, file)).catch(() => null);
        if (!data) continue;
        content.push({ type: "text", text: `Image: ${store.bundleDirForAgent(id)}/${file}` });
        content.push({ type: "image", data: data.toString("base64"), mimeType: "image/png" });
      }
    }
  }
  return content;
}

async function takePending(store: Store): Promise<string[]> {
  const pending = await store.listBundles("pending");
  for (const b of pending) await store.setStatus(b.id, "delivered");
  return pending.map((b) => b.id);
}

const imagesParam = z
  .enum(["all", "crops", "none"])
  .default("all")
  .describe("Which images to attach: full annotated screenshots and crops (all), only the boxed crops, or none.");

export async function runMcpServer(store: Store, port: number): Promise<void> {
  await store.init();
  let ui: { url: string } | null = null;
  // The UI server is started lazily so an agent that never asks for it costs nothing.
  const uiUrl = async () => (ui ??= await ensureServer(store, port)).url;

  const mcp = new McpServer({ name: "lookhere", version: VERSION });

  mcp.registerTool(
    "open_annotator",
    {
      title: "Open the lookhere annotator",
      description:
        "Opens the lookhere annotator in the user's browser. There the user captures screens (paste, file, screen share, or URL), " +
        "draws boxes on the parts they mean, writes a note per box, and presses Send. Use when the user wants to show you UI changes visually. " +
        "Then call wait_for_feedback to receive what they send.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { open_browser: z.boolean().default(true).describe("Also open it in the default browser.") },
    },
    async ({ open_browser }) => {
      const url = await uiUrl();
      if (open_browser) openInBrowser(url);
      return { content: [{ type: "text", text: `lookhere annotator: ${url}\nAsk the user to box what they want changed and press Send.` }] };
    },
  );

  mcp.registerTool(
    "capture_url",
    {
      title: "Capture a page for the user to annotate",
      description:
        "Screenshots a URL (usually the local dev server) in a headless browser and records its DOM elements, so each box the user draws " +
        "is linked to real selectors and component names. The capture appears in the annotator for the user to mark up.",
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      inputSchema: {
        url: z.string().url().describe("Page to capture, e.g. http://localhost:3000/"),
        width: z.number().int().min(200).max(3840).default(1280),
        height: z.number().int().min(200).max(2160).default(800),
        full_page: z.boolean().default(false),
        open_browser: z.boolean().default(true).describe("Open the annotator afterwards."),
      },
    },
    async ({ url, width, height, full_page, open_browser }) => {
      const shot = await captureUrl({ url, width, height, fullPage: full_page, projectDir: store.projectDir });
      const draft = await store.createDraft(shot.png, shot.source, shot.elements);
      const annotator = await uiUrl();
      if (open_browser) openInBrowser(annotator);
      return {
        content: [
          {
            type: "text",
            text:
              `Captured ${shot.source.url} (${draft.image.width}×${draft.image.height}, ${shot.elements.length} elements). ` +
              `It is waiting in the annotator at ${annotator}. Ask the user to box what they want changed and press Send, then call wait_for_feedback.`,
          },
        ],
      };
    },
  );

  mcp.registerTool(
    "get_feedback",
    {
      title: "Get UI feedback the user sent",
      description:
        "Returns feedback bundles the user sent from lookhere and has not been delivered yet: numbered boxes with notes, " +
        "the elements under each box, and the screenshots. Returns a short message when there is nothing new.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: { images: imagesParam },
    },
    async ({ images }) => {
      const ids = await takePending(store);
      if (ids.length === 0) return { content: [{ type: "text", text: "No new lookhere feedback." }] };
      return { content: await bundlesAsContent(store, ids, images) };
    },
  );

  mcp.registerTool(
    "wait_for_feedback",
    {
      title: "Wait for the user to send UI feedback",
      description:
        "Blocks until the user presses Send in the lookhere annotator (or the timeout passes), then returns the feedback like get_feedback.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        timeout_seconds: z.number().int().min(5).max(1800).default(300),
        images: imagesParam,
      },
    },
    async ({ timeout_seconds, images }, extra) => {
      const deadline = Date.now() + timeout_seconds * 1000;
      while (Date.now() < deadline && !extra.signal.aborted) {
        const ids = await takePending(store);
        if (ids.length) return { content: await bundlesAsContent(store, ids, images) };
        await new Promise((r) => setTimeout(r, 700));
      }
      return {
        content: [{ type: "text", text: `No feedback within ${timeout_seconds}s. The annotator is at ${await uiUrl()}; call wait_for_feedback again to keep waiting.` }],
      };
    },
  );

  mcp.registerTool(
    "list_feedback",
    {
      title: "List lookhere feedback bundles",
      description: "Lists feedback bundles with their status (pending, delivered, done).",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { status: z.enum(["pending", "delivered", "done"]).optional() },
    },
    async ({ status }) => {
      const list = await store.listBundles(status);
      const text = list.length
        ? list.map((b) => `${b.id}  ${b.status.padEnd(9)}  ${b.captures} screen(s), ${b.boxes} box(es)  ${b.message}`).join("\n")
        : "No feedback bundles.";
      return { content: [{ type: "text", text }] };
    },
  );

  mcp.registerTool(
    "show_feedback",
    {
      title: "Show one feedback bundle again",
      description: "Returns a feedback bundle by id, whatever its status.",
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: { bundle_id: z.string(), images: imagesParam },
    },
    async ({ bundle_id, images }) => ({ content: await bundlesAsContent(store, [bundle_id], images) }),
  );

  mcp.registerTool(
    "mark_done",
    {
      title: "Mark feedback as handled",
      description: "Marks a feedback bundle as done after you have made the requested changes.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      inputSchema: { bundle_id: z.string() },
    },
    async ({ bundle_id }) => {
      await store.setStatus(bundle_id, "done");
      return { content: [{ type: "text", text: `Marked ${bundle_id} as done.` }] };
    },
  );

  await mcp.connect(new StdioServerTransport());
}
