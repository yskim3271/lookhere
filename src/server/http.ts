import { createReadStream, existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Box, CaptureSource } from "../shared/types.js";
import { captureUrl } from "./capture-url.js";
import { Store, decodeDataUrl, type SendItem } from "./store.js";

export const DEFAULT_PORT = 7357;

const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function readJson<T>(req: http.IncomingMessage, limit = 200 * 1024 * 1024): Promise<T> {
  if (!String(req.headers["content-type"] ?? "").includes("application/json")) {
    throw new HttpError(415, "Expected application/json");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, "Request too large");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function serveFile(res: http.ServerResponse, file: string, cache = false): Promise<void> {
  const s = await stat(file).catch(() => null);
  if (!s?.isFile()) throw new HttpError(404, "Not found");
  res.writeHead(200, {
    "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    "content-length": s.size,
    "cache-control": cache ? "public, max-age=31536000, immutable" : "no-store",
  });
  createReadStream(file).pipe(res);
}

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

export async function startServer(store: Store, port = DEFAULT_PORT): Promise<RunningServer> {
  await store.init();

  const server = http.createServer(async (req, res) => {
    try {
      // Only answer to our own origin. Blocks DNS-rebinding pages from reading local screenshots.
      const host = String(req.headers.host ?? "");
      const actualPort = (server.address() as { port: number }).port;
      if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) {
        throw new HttpError(403, "Forbidden host");
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (parts[0] !== "api") {
        if (!existsSync(path.join(WEB_DIR, "index.html"))) {
          throw new HttpError(500, "UI not built. Run `npm run build` in the lookhere package.");
        }
        const rel = parts.length ? path.normalize(parts.join("/")) : "index.html";
        const file = path.join(WEB_DIR, rel);
        if (!file.startsWith(WEB_DIR)) throw new HttpError(404, "Not found");
        const found = existsSync(file) ? file : path.join(WEB_DIR, "index.html");
        return await serveFile(res, found, rel.startsWith("assets"));
      }

      const [, resource, id, sub] = parts;

      if (resource === "health") {
        return send(res, 200, { ok: true, app: "lookhere", projectDir: store.projectDir });
      }

      if (resource === "drafts") {
        if (!id && method === "GET") return send(res, 200, await store.listDrafts());
        if (!id && method === "POST") {
          const body = await readJson<{ image: string; source?: { kind?: string; title?: string } }>(req);
          const kind = body.source?.kind;
          const source: CaptureSource = {
            kind: kind === "file" || kind === "screen" ? kind : "paste",
            ...(body.source?.title ? { title: String(body.source.title).slice(0, 200) } : {}),
          };
          return send(res, 201, await store.createDraft(decodeDataUrl(body.image), source));
        }
        if (id && sub === "image" && method === "GET") return await serveFile(res, store.draftImagePath(id));
        if (id && !sub && method === "PUT") {
          const body = await readJson<{ boxes?: Box[]; note?: string }>(req);
          return send(res, 200, await store.updateDraft(id, body));
        }
        if (id && !sub && method === "DELETE") {
          await store.deleteDraft(id);
          return send(res, 200, { ok: true });
        }
      }

      if (resource === "capture-url" && method === "POST") {
        const body = await readJson<{ url: string; width?: number; height?: number; fullPage?: boolean }>(req);
        if (!/^https?:\/\//i.test(body.url ?? "")) throw new HttpError(400, "URL must start with http:// or https://");
        const shot = await captureUrl({ ...body, projectDir: store.projectDir });
        return send(res, 201, await store.createDraft(shot.png, shot.source, shot.elements));
      }

      if (resource === "send" && method === "POST") {
        const body = await readJson<{
          message?: string;
          captures: { captureId: string; annotated: string; crops: Record<string, string> }[];
        }>(req);
        const items: SendItem[] = body.captures.map((c) => ({
          captureId: c.captureId,
          annotated: decodeDataUrl(c.annotated),
          crops: Object.fromEntries(Object.entries(c.crops ?? {}).map(([k, v]) => [k, decodeDataUrl(v)])),
        }));
        const bundle = await store.send(items, String(body.message ?? ""));
        return send(res, 201, {
          bundle,
          markdown: await store.getBundleMarkdown(bundle.id),
          dir: store.bundleDirForAgent(bundle.id),
        });
      }

      if (resource === "bundles" && method === "GET") {
        if (!id) return send(res, 200, await store.listBundles());
        if (sub) return await serveFile(res, store.bundleFile(id, sub));
        return send(res, 200, { bundle: await store.getBundle(id), status: await store.getStatus(id) });
      }

      throw new HttpError(404, "Not found");
    } catch (e) {
      const status = e instanceof HttpError ? e.status : /ENOENT/.test(String(e)) ? 404 : 500;
      if (!res.headersSent) send(res, status, { error: (e as Error).message });
      else res.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
  const actual = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${actual}/`,
    port: actual,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** Which lookhere project, if any, is served on `port`. `null` when nothing (or something else) answers. */
async function probe(port: number): Promise<string | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(800) });
    const body = (await res.json()) as { app?: string; projectDir?: string };
    return body.app === "lookhere" ? (body.projectDir ?? null) : null;
  } catch {
    return null;
  }
}

/**
 * Reuses a running UI server for this project, or starts one. Lets several projects
 * (and the CLI plus the MCP server of one project) coexist.
 *
 * The chosen port is recorded in `.lookhere/server.json` so other processes find it even
 * when the preferred ports were taken (Windows reserves random port ranges for Hyper-V).
 */
export async function ensureServer(
  store: Store,
  port = DEFAULT_PORT,
): Promise<{ url: string; port: number; server?: RunningServer }> {
  const same = (project: string | null) => project !== null && path.resolve(project) === path.resolve(store.projectDir);
  const record = await readFile(store.serverFile, "utf8").then((t) => JSON.parse(t) as { port?: number }, () => null);
  if (record?.port && same(await probe(record.port))) return { url: `http://127.0.0.1:${record.port}/`, port: record.port };

  const candidates = [...Array.from({ length: 10 }, (_, i) => port + i), 0];
  for (const p of candidates) {
    if (p !== 0) {
      const project = await probe(p);
      if (same(project)) return { url: `http://127.0.0.1:${p}/`, port: p };
      if (project !== null) continue;
    }
    try {
      const server = await startServer(store, p);
      await writeFile(store.serverFile, JSON.stringify({ port: server.port, pid: process.pid }));
      return { url: server.url, port: server.port, server };
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== "EADDRINUSE" && code !== "EACCES") throw e;
    }
  }
  throw new Error("Could not find a free port");
}
