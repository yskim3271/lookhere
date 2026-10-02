#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { runMcpServer } from "./mcp/server.js";
import { openInBrowser } from "./open.js";
import { captureUrl } from "./server/capture-url.js";
import { DEFAULT_PORT, ensureServer } from "./server/http.js";
import { Store } from "./server/store.js";

const HELP = `lookhere: box the part of the screen you mean, add a note, hand it to your AI coding agent.

Usage
  lookhere [open]            Start the annotator and open it in the browser
  lookhere mcp               Run the MCP server (stdio) for Claude Code, Codex, Cursor, ...
  lookhere pull              Print feedback the agent has not received yet, then mark it delivered
  lookhere capture <url>     Screenshot a page (with its DOM elements) into the annotator
  lookhere setup [agent]     Show how to connect an agent: claude, codex, cursor
  lookhere hook              For a Claude Code UserPromptSubmit hook: print new feedback, if any

Options
  --dir <path>      Project folder; feedback is stored in <dir>/.lookhere (default: current folder)
  --port <n>        Annotator port (default ${DEFAULT_PORT}, next free port if taken)
  --no-open         Do not open the browser
  --keep            pull: leave feedback marked as pending
  --json            pull: print JSON instead of Markdown
  --width, --height capture: viewport size (default 1280×800)
  --full-page       capture: whole scrollable page
`;

function mcpCommand(): { command: string; args: string[] } {
  const self = fileURLToPath(import.meta.url);
  if (self.split(path.sep).includes("node_modules")) return { command: "npx", args: ["-y", "lookhere", "mcp"] };
  return { command: "node", args: [self, "mcp"] };
}

function setupText(agent?: string): string {
  const { command, args } = mcpCommand();
  const quoted = [command, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
  const sections: Record<string, string> = {
    claude: `Claude Code: run in your project\n\n  claude mcp add lookhere -- ${quoted}\n\nOptional: deliver feedback automatically with every prompt by adding a UserPromptSubmit hook\nthat runs:  ${quoted.replace(/ mcp$/, " hook")}`,
    codex: `Codex: run\n\n  codex mcp add lookhere -- ${quoted}\n\nor add to ~/.codex/config.toml:\n\n  [mcp_servers.lookhere]\n  command = ${JSON.stringify(command)}\n  args = ${JSON.stringify(args)}\n\nCodex asks before each MCP tool call. To skip that (required for \`codex exec\`), add:\n\n  default_tools_approval_mode = "approve"`,
    cursor: `Cursor: add to .cursor/mcp.json in your project\n\n${JSON.stringify({ mcpServers: { lookhere: { command, args } } }, null, 2)
      .split("\n")
      .map((l) => "  " + l)
      .join("\n")}`,
  };
  if (agent && !sections[agent]) throw new Error(`Unknown agent "${agent}". Try: claude, codex, cursor`);
  const body = agent ? sections[agent] : Object.values(sections).join("\n\n");
  return `${body}\n\nThen ask the agent: "open lookhere" or "check my lookhere feedback".\n`;
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      port: { type: "string" },
      "no-open": { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      width: { type: "string" },
      height: { type: "string" },
      "full-page": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
    },
  });
  const [cmd = "open", arg] = positionals;
  if (values.help || cmd === "help") return void process.stdout.write(HELP);
  if (values.version) return void process.stdout.write("0.1.0\n");

  const store = new Store(path.resolve(values.dir ?? process.env.LOOKHERE_DIR ?? process.cwd()));
  const port = Number(values.port ?? process.env.LOOKHERE_PORT ?? DEFAULT_PORT);

  switch (cmd) {
    case "open": {
      const ui = await ensureServer(store, port);
      if (!values["no-open"]) openInBrowser(ui.url);
      console.log(`lookhere annotator: ${ui.url}`);
      console.log(`Feedback is saved in ${store.inboxDir}`);
      if (ui.server) console.log("Press Ctrl+C to stop.");
      return;
    }
    case "mcp":
      return runMcpServer(store, port);
    case "pull":
    case "hook": {
      await store.init();
      const pending = await store.listBundles("pending");
      if (pending.length === 0) {
        if (cmd === "pull") console.error("No new lookhere feedback.");
        return;
      }
      if (values.json) {
        const bundles = await Promise.all(pending.map((b) => store.getBundle(b.id)));
        process.stdout.write(JSON.stringify(bundles, null, 2) + "\n");
      } else {
        for (const b of pending) process.stdout.write((await store.getBundleMarkdown(b.id)) + "\n");
      }
      if (!values.keep) for (const b of pending) await store.setStatus(b.id, "delivered");
      return;
    }
    case "capture": {
      if (!arg) throw new Error("Usage: lookhere capture <url>");
      await store.init();
      const shot = await captureUrl({
        url: arg,
        width: values.width ? Number(values.width) : undefined,
        height: values.height ? Number(values.height) : undefined,
        fullPage: values["full-page"],
        projectDir: store.projectDir,
      });
      const draft = await store.createDraft(shot.png, shot.source, shot.elements);
      console.log(`Captured ${shot.source.url} with ${shot.elements.length} elements (draft ${draft.id}).`);
      const ui = await ensureServer(store, port);
      if (!values["no-open"]) openInBrowser(ui.url);
      console.log(`Annotate it at ${ui.url}`);
      if (!ui.server) process.exit(0);
      return;
    }
    case "setup":
      return void process.stdout.write(setupText(arg));
    default:
      throw new Error(`Unknown command "${cmd}".\n\n${HELP}`);
  }
}

main().catch((e) => {
  console.error(`lookhere: ${(e as Error).message}`);
  process.exit(1);
});
