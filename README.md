# lookhere

**Point at the screen, tell your AI agent what to change.**

Capture any screen, drag a box over the part you mean, write a note, and send it.
Your coding agent (Claude Code, Codex, Cursor, or anything that speaks MCP) receives
numbered boxes, your notes, cropped images, and, for web pages, the real DOM elements
and component names under each box.

```
 capture  →  box  →  note  →  collect  →  send to the agent session
```

[한국어 README](README.ko.md)

## Why

"The blue button top right, no, the second one, next to Docs…" is a slow way to ask for a UI change.
Codex and Claude's desktop apps added in-app annotation, but only inside their own browsers.
lookhere works with **any agent** and **any screen**: a web page, an iOS simulator, an Android emulator,
an Electron app, a design mockup.

## Quick start

```bash
npx lookhere
```

The annotator opens in your browser. Then connect your agent:

```bash
npx lookhere setup claude    # or: codex, cursor
```

| Agent | Command |
|---|---|
| Claude Code | `claude mcp add lookhere -- npx -y lookhere mcp` |
| Codex | `codex mcp add lookhere -- npx -y lookhere mcp` |
| Cursor | add `{"mcpServers":{"lookhere":{"command":"npx","args":["-y","lookhere","mcp"]}}}` to `.cursor/mcp.json` |

Now ask your agent: *"open lookhere"*, *"capture localhost:3000 so I can mark it up"*, or *"check my lookhere feedback"*.

Codex asks before every MCP tool call. For `codex exec` (no one to approve), allow lookhere's tools in
`~/.codex/config.toml` under `[mcp_servers.lookhere]` with `default_tools_approval_mode = "approve"`.

## Capturing

| How | Best for | Element mapping |
|---|---|---|
| **Paste** (`Ctrl+V` / `⌘V`) a screenshot from your OS tool | anything | no |
| **Drop / open** an image file | mockups, bug reports | no |
| **Share screen**, then *Capture frame* (or *Capture in 3 s*) | simulators, emulators, desktop apps; keep interacting and grab several frames | no |
| **Capture URL** (headless Chrome/Edge) | your dev server | **yes**: selector, text, React/Vue/Svelte component, source file and line in dev builds |

In a React dev build, each element is traced to the JSX that rendered it: React 19's debug stack gives
the module location, and the dev server's source map turns it back into the original file and line
(`src/NavButton.jsx:3`). React 18 and earlier expose that location directly.

### Android

With an emulator or a phone with USB debugging on, `lookhere capture --android` (or the agent's
`capture_android` tool) grabs the current screen and its UI tree. Run it from your Android project and
each box is also linked to where that view lives in your code:

```markdown
- `com.acme.notes:id/signup_button` · <Button> · "Sign up" (matches the box)
    - source `app/src/main/res/layout/activity_login.xml:20` (android:id @+id/signup_button)
    - source `app/src/main/java/com/acme/notes/LoginActivity.kt:15` (binding.signupButton)
```

Evidence used, strongest first: layout `@+id` and Compose `testTag` (with `testTagsAsResourceId`),
`R.id` / ViewBinding references, string resources (any locale) and where they are used, hard-coded text.
Elements from other apps on screen (launcher, system UI) are never linked. adb is found through
`ANDROID_HOME`, the default SDK folder, a winget install, or `PATH` (override with `LOOKHERE_ADB`).
`lookhere devices` lists what adb sees.

Draw boxes by dragging. Drag a box to move it, drag a corner to resize, press `Delete` to remove it.
Every box gets its own note; each screen can have a note too. Captures stay in the tray until you send.

## What the agent receives

One **bundle** per Send, written to `.lookhere/inbox/<id>/` in your project:

```
feedback.md            instructions for the agent (below)
feedback.json          the same, structured
screen-1.png           screenshot with numbered boxes
screen-1-original.png  screenshot without marks
screen-1-box-1.png     crop of each box
```

```markdown
### 1.1 Make this button bigger and more visible

- Region: x=1155 y=4 w=103 h=57
- Crop: `.lookhere/inbox/20261002-083554337-1b50/screen-1-box-1.png`
- Elements under the box:
  - `body > header > nav > button[data-testid="signup"]` · <button> · "Sign up" (inside the box)
  - `body > header` · <header> · "Acme Notes Features Pricing Docs Sign up" (wraps the box)
```

Three ways to get it into the session:

1. **MCP** (recommended): the `get_feedback` / `wait_for_feedback` tools return the text and the images.
2. **CLI**: `lookhere pull` prints new feedback as Markdown (pipe it anywhere, `--json` for JSON).
3. **Files**: point the agent at `.lookhere/inbox/`. The UI also has *Copy as Markdown*.

For Claude Code you can also deliver feedback automatically: add a `UserPromptSubmit` hook that runs
`npx -y lookhere hook`. It prints new feedback (and nothing otherwise), which Claude Code adds to your next prompt.

## MCP tools

| Tool | What it does |
|---|---|
| `open_annotator` | Opens the annotator in the user's browser |
| `capture_url` | Screenshots a URL with its DOM elements and puts it in the annotator |
| `capture_android` | Captures an Android device's screen with its UI tree (and source links) |
| `list_android_devices` | Lists emulators and phones visible to adb |
| `wait_for_feedback` | Waits until the user presses Send, then returns the feedback |
| `get_feedback` | Returns feedback not yet delivered |
| `list_feedback` / `show_feedback` | Browse earlier bundles |
| `mark_done` | Marks a bundle as handled |

`images` (`all` · `crops` · `none`) controls how many images are attached.

## CLI

```
lookhere [open]            Start the annotator and open it in the browser
lookhere mcp               Run the MCP server (stdio)
lookhere pull              Print feedback the agent has not received yet
lookhere capture <url>     Screenshot a page (with its DOM elements) into the annotator
lookhere capture --android Capture the connected Android device (--serial, --delay)
lookhere devices           List Android devices visible to adb
lookhere setup [agent]     Show how to connect claude, codex, or cursor
lookhere hook              For a Claude Code UserPromptSubmit hook

--dir <path>   project folder (default: current folder; or LOOKHERE_DIR)
--port <n>     annotator port (default 7357; falls back to a free port)
```

## How it works

Everything is local. The annotator is a small web app served on `127.0.0.1`; it only answers requests
addressed to its own host. State lives in files under `<project>/.lookhere/`, so the UI server, the MCP
server, and the CLI can be separate processes and still see the same captures. `.lookhere/` ignores itself in git.

URL capture uses `playwright-core` with the Chrome or Edge you already have installed, so nothing large is
downloaded. If neither is present, run `npx playwright install chromium`.

## Development

```bash
npm install
npm run build      # UI (Vite) + Node (tsc) into dist/
npm test           # unit tests (Vitest)
npm run e2e        # real browser: screen share -> box -> note -> send (needs Chrome or Edge)
node dist/cli.js   # run from source
npm run dev:web    # UI with hot reload; start `node dist/cli.js --no-open` alongside for the API
```

See [docs/PLAN.md](docs/PLAN.md) for the MVP scope and what comes next
(desktop overlay with a global shortcut, Flutter/Android/iOS element trees, arrows and freehand marks).

## License

MIT
