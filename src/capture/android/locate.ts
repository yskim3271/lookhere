import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ElementInfo, SourceHit } from "../../shared/types.js";

interface Loc {
  file: string;
  line: number;
}

const SKIP_DIRS = new Set(["build", ".gradle", ".git", ".idea", "node_modules", ".lookhere", "out", ".cxx", ".kotlin", "generated"]);
const CODE_EXT = new Set([".kt", ".java"]);
const BUILD_FILES = new Set(["build.gradle", "build.gradle.kts", "AndroidManifest.xml"]);
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1024 * 1024;

/** Strength of each kind of evidence, highest first. */
const SCORE = {
  layoutId: 100,
  testTag: 100,
  idRef: 90,
  binding: 85,
  stringRef: 70,
  literal: 60,
  stringDef: 50,
} as const;

function push(map: Map<string, Loc[]>, key: string, loc: Loc): void {
  const list = map.get(key);
  if (list) list.push(loc);
  else map.set(key, [loc]);
}

/** `signup_button` -> `signupButton` (the ViewBinding field name). */
export function bindingName(id: string): string {
  return id.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Android string resources escape quotes and apostrophes; XML escapes entities. */
function unescapeAndroidString(s: string): string {
  return s
    .replace(/^"(.*)"$/s, "$1")
    .replace(/\\(['"@?])/g, "$1")
    .replace(/\\n/g, "\n")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function unescapeCodeString(s: string): string {
  return s.replace(/\\(["'\\$])/g, "$1").replace(/\\n/g, "\n");
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * An index of the places an Android project names its views and texts. Built once per
 * project by scanning layouts, string resources, and Kotlin/Java sources line by line,
 * so looking up an element is a few map reads.
 */
export class SourceIndex {
  readonly idDefs = new Map<string, Loc[]>(); // android:id="@+id/name"
  readonly idRefs = new Map<string, Loc[]>(); // R.id.name, @id/name
  readonly bindingRefs = new Map<string, Loc[]>(); // binding.camelName
  readonly stringDefs = new Map<string, { name: string; loc: Loc }[]>(); // value -> <string name>
  readonly stringRefs = new Map<string, Loc[]>(); // R.string.name, @string/name
  readonly literals = new Map<string, Loc[]>(); // "Text" in code, android:text="Text"
  readonly testTags = new Map<string, Loc[]>(); // testTag("x")
  readonly classes = new Map<string, Loc>(); // class Name / object Name
  /** App packages declared by the project (namespace, applicationId, manifest package). */
  readonly packages = new Set<string>();
  files = 0;

  constructor(readonly projectDir: string) {}

  static async build(projectDir: string): Promise<SourceIndex> {
    const index = new SourceIndex(projectDir);
    for (const file of await listFiles(projectDir)) {
      const rel = path.relative(projectDir, file).split(path.sep).join("/");
      const text = await readFile(file, "utf8").catch(() => null);
      if (text === null) continue;
      index.files++;
      const base = path.basename(file);
      if (BUILD_FILES.has(base)) index.addBuildFile(text);
      else if (CODE_EXT.has(path.extname(file))) index.addCode(rel, text);
      else index.addXml(rel, text);
    }
    return index;
  }

  addBuildFile(text: string): void {
    const re = /\b(?:namespace|applicationId)\s*=?\s*["']([\w.]+)["']|<manifest\b[^>]*\bpackage\s*=\s*"([\w.]+)"/g;
    for (const m of text.matchAll(re)) this.packages.add(m[1] ?? m[2]);
  }

  /**
   * Whether an on-screen element belongs to this project. Elements from other apps
   * (launcher, Settings, system UI) would only produce coincidental text matches.
   * Debug builds often add a suffix (com.acme.debug), so prefixes count.
   */
  ownsPackage(pkg: string | undefined): boolean {
    if (!pkg || this.packages.size === 0) return true;
    for (const p of this.packages) if (pkg === p || pkg.startsWith(p + ".") || p.startsWith(pkg + ".")) return true;
    return false;
  }

  addXml(file: string, text: string): void {
    const isStrings = /\/res\/values[^/]*\/[^/]*\.xml$/.test("/" + file);
    text.split(/\r?\n/).forEach((lineText, i) => {
      const loc = { file, line: i + 1 };
      for (const m of lineText.matchAll(/android:id\s*=\s*"@\+id\/(\w+)"/g)) push(this.idDefs, m[1], loc);
      for (const m of lineText.matchAll(/"@id\/(\w+)"/g)) push(this.idRefs, m[1], loc);
      for (const m of lineText.matchAll(/@string\/(\w+)/g)) push(this.stringRefs, m[1], loc);
      for (const m of lineText.matchAll(/android:(?:text|hint|contentDescription)\s*=\s*"([^"@?][^"]*)"/g)) {
        push(this.literals, norm(m[1]), loc);
      }
      // All locales: a device set to Korean shows the values-ko text, which still names the resource.
      if (isStrings) {
        for (const m of lineText.matchAll(/<string\s+name="(\w+)"[^>]*>(.*?)<\/string>/g)) {
          const value = norm(unescapeAndroidString(m[2]));
          const list = this.stringDefs.get(value) ?? [];
          list.push({ name: m[1], loc });
          this.stringDefs.set(value, list);
        }
      }
    });
  }

  addCode(file: string, text: string): void {
    text.split(/\r?\n/).forEach((lineText, i) => {
      const loc = { file, line: i + 1 };
      const code = lineText.replace(/\/\/.*$/, (c) => (c.includes('"') ? c : "")); // drop line comments without strings
      for (const m of code.matchAll(/\bR\.id\.(\w+)/g)) push(this.idRefs, m[1], loc);
      for (const m of code.matchAll(/\bR\.string\.(\w+)/g)) push(this.stringRefs, m[1], loc);
      for (const m of code.matchAll(/\bbinding\.(\w+)/g)) push(this.bindingRefs, m[1], loc);
      for (const m of code.matchAll(/testTag\(\s*"([^"]+)"\s*\)/g)) push(this.testTags, m[1], loc);
      for (const m of code.matchAll(/\b(?:class|object)\s+(\w+)/g)) if (!this.classes.has(m[1])) this.classes.set(m[1], loc);
      for (const m of code.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
        // Lookups are exact matches against on-screen text, so non-UI strings are harmless here.
        const value = norm(unescapeCodeString(m[1]));
        if (value) push(this.literals, value, loc);
      }
    });
  }

  /**
   * Likely source locations for one screen element, strongest first.
   * `activity` (e.g. "com.acme/.LoginActivity") breaks ties toward the screen's own file.
   */
  locate(el: ElementInfo, activity?: string, limit = 3): SourceHit[] {
    if (!this.ownsPackage(el.package)) return [];
    const hits: (SourceHit & { score: number })[] = [];
    const add = (locs: Loc[] | undefined, reason: string, score: number) => {
      for (const l of locs ?? []) hits.push({ file: l.file, line: l.line, reason, score });
    };

    const rid = el.id ?? "";
    const idMatch = /^([\w.]+):id\/(\w+)$/.exec(rid);
    if (idMatch && idMatch[1] !== "android") {
      const name = idMatch[2];
      add(this.idDefs.get(name), `android:id @+id/${name}`, SCORE.layoutId);
      add(this.idRefs.get(name), `R.id.${name}`, SCORE.idRef);
      add(this.bindingRefs.get(bindingName(name)), `binding.${bindingName(name)}`, SCORE.binding);
    } else if (rid && !rid.includes(":id/")) {
      // Compose with testTagsAsResourceId reports the testTag as the resource-id.
      add(this.testTags.get(rid), `testTag("${rid}")`, SCORE.testTag);
    }

    // Text is only evidence for the element that shows it, not for containers that merely hold it.
    const texts = [el.textFromChildren ? undefined : el.text, el.label].filter((t): t is string => !!t);
    for (const t of new Set(texts.map(norm))) {
      const defs = this.stringDefs.get(t) ?? [];
      for (const d of defs) {
        const refs = this.stringRefs.get(d.name);
        if (refs?.length) add(refs, `R.string.${d.name} = "${t}"`, SCORE.stringRef);
        else add([d.loc], `<string name="${d.name}">`, SCORE.stringDef);
      }
      add(this.literals.get(t), `text "${t}"`, SCORE.literal);
    }

    const screenFile = activity ? this.activityFile(activity)?.file : undefined;
    const seen = new Set<string>();
    return hits
      .sort((a, b) => b.score - a.score || Number(b.file === screenFile) - Number(a.file === screenFile))
      .filter((h) => {
        const key = `${h.file}:${h.line}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, limit)
      .map(({ file, line, reason }) => ({ file, line, reason }));
  }

  /** Where the foreground activity class is declared. */
  activityFile(activity: string): Loc | undefined {
    const cls = activity.split("/").pop()?.split(".").pop();
    return cls ? this.classes.get(cls) : undefined;
  }
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    if (out.length >= MAX_FILES) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) await walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        const isRes = ext === ".xml" && full.split(path.sep).includes("res");
        if (!CODE_EXT.has(ext) && !isRes && !BUILD_FILES.has(e.name)) continue;
        const s = await stat(full).catch(() => null);
        if (s && s.size <= MAX_FILE_BYTES) out.push(full);
        if (out.length >= MAX_FILES) return;
      }
    }
  };
  await walk(root);
  return out;
}

const cache = new Map<string, { at: number; index: Promise<SourceIndex>; refreshing?: boolean }>();
const STALE_MS = 30_000;

/**
 * Index for a project. Large projects take seconds to scan, so after the first build a stale
 * index is returned at once while a fresh one is built in the background (edits made between
 * captures show up on the next capture). Call early, e.g. when the server starts, to warm it.
 */
export function sourceIndexFor(projectDir: string): Promise<SourceIndex> {
  const hit = cache.get(projectDir);
  if (!hit) {
    const entry = { at: Date.now(), index: SourceIndex.build(projectDir) };
    cache.set(projectDir, entry);
    entry.index.catch(() => cache.delete(projectDir));
    return entry.index;
  }
  if (Date.now() - hit.at > STALE_MS && !hit.refreshing) {
    hit.refreshing = true;
    SourceIndex.build(projectDir).then(
      (fresh) => cache.set(projectDir, { at: Date.now(), index: Promise.resolve(fresh) }),
      () => (hit.refreshing = false),
    );
  }
  return hit.index;
}

/** Adds `sources` (and `source`, the best one) to each element. Returns the activity's file, if found. */
export async function attachSources(elements: ElementInfo[], projectDir: string, activity?: string): Promise<string | undefined> {
  const index = await sourceIndexFor(projectDir);
  for (const el of elements) {
    const hits = index.locate(el, activity);
    if (hits.length) {
      el.sources = hits;
      el.source = `${hits[0].file}:${hits[0].line}`;
    }
  }
  const act = activity && index.ownsPackage(activity.split("/")[0]) ? index.activityFile(activity) : undefined;
  return act ? `${act.file}:${act.line}` : undefined;
}
