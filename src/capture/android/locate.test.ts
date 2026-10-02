import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { ElementInfo } from "../../shared/types.js";
import { SourceIndex, attachSources, bindingName } from "./locate.js";

// A small Android project (not buildable, just sources) with Views and Compose.
const root = fileURLToPath(new URL("../../../test/fixtures/android/demo-project/", import.meta.url));
const MAIN = "app/src/main";
const LAYOUT = `${MAIN}/res/layout/activity_login.xml`;
const STRINGS = `${MAIN}/res/values/strings.xml`;
const LOGIN = `${MAIN}/java/com/acme/notes/LoginActivity.kt`;
const HOME = `${MAIN}/java/com/acme/notes/ui/HomeScreen.kt`;

/** 1-based line of the first line containing `needle`, so tests don't hard-code line numbers. */
function lineOf(file: string, needle: string): number {
  const i = readFileSync(root + file, "utf8").split(/\r?\n/).findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`${needle} not in ${file}`);
  return i + 1;
}

const el = (over: Partial<ElementInfo>): ElementInfo => ({
  platform: "android",
  selector: "x",
  tag: "View",
  rect: { x: 0, y: 0, w: 10, h: 10 },
  ...over,
});

let index: SourceIndex;
beforeAll(async () => {
  index = await SourceIndex.build(root);
});

describe("SourceIndex.locate", () => {
  it("finds a View by its id: layout definition first, then code that uses it", () => {
    const hits = index.locate(el({ id: "com.acme.notes:id/signup_button", text: "Sign up", tag: "Button" }));
    expect(hits[0]).toEqual({ file: LAYOUT, line: lineOf(LAYOUT, "@+id/signup_button"), reason: "android:id @+id/signup_button" });
    expect(hits).toContainEqual({ file: LOGIN, line: lineOf(LOGIN, "binding.signupButton"), reason: "binding.signupButton" });
  });

  it("finds R.id references in code", () => {
    const hits = index.locate(el({ id: "com.acme.notes:id/terms" }));
    expect(hits.map((h) => h.file)).toEqual([LAYOUT, LOGIN]);
    expect(hits[1].line).toBe(lineOf(LOGIN, "R.id.terms"));
  });

  it("treats a bare resource-id as a Compose testTag", () => {
    const hits = index.locate(el({ id: "new_note_button" }));
    expect(hits[0]).toEqual({ file: HOME, line: lineOf(HOME, 'testTag("new_note_button")'), reason: 'testTag("new_note_button")' });
  });

  it("follows text to the string resource and to where it is used", () => {
    const hits = index.locate(el({ text: "Recent notes" }));
    expect(hits[0]).toEqual({ file: HOME, line: lineOf(HOME, "R.string.recent_notes"), reason: 'R.string.recent_notes = "Recent notes"' });
  });

  it("matches translated text from other locales", () => {
    const hits = index.locate(el({ text: "가입하기" }));
    expect(hits[0]).toEqual({ file: LAYOUT, line: lineOf(LAYOUT, "@string/sign_up"), reason: '@string/sign_up = "가입하기"' });
  });

  it("falls back to the string definition when nothing references it", () => {
    const hits = index.locate(el({ text: "Can't log in?" }));
    expect(hits[0]).toEqual({ file: STRINGS, line: lineOf(STRINGS, "cant_login"), reason: '<string name="cant_login">' });
  });

  it("finds hard-coded text and content descriptions", () => {
    expect(index.locate(el({ text: "New note" }))[0]).toMatchObject({ file: HOME, line: lineOf(HOME, '"New note"') });
    expect(index.locate(el({ label: "Search notes" }))[0]).toMatchObject({ file: HOME, line: lineOf(HOME, '"Search notes"') });
    expect(index.locate(el({ text: "By continuing you agree to the terms" }))[0]).toMatchObject({ file: LAYOUT });
  });

  it("ignores framework ids, container text, and build output", () => {
    expect(index.locate(el({ id: "android:id/title" }))).toEqual([]);
    expect(index.locate(el({ text: "Recent notes", textFromChildren: true }))).toEqual([]);
    const all = [...index.literals.values(), ...index.idRefs.values()].flat();
    expect(all.some((l) => l.file.includes("/build/"))).toBe(false);
  });
});

describe("other apps on screen", () => {
  it("reads the project's packages from Gradle", () => {
    expect([...index.packages]).toEqual(["com.acme.notes"]);
  });

  it("skips elements from other apps but keeps debug-suffixed builds", () => {
    expect(index.locate(el({ text: "Recent notes", package: "com.android.settings" }))).toEqual([]);
    expect(index.locate(el({ text: "Recent notes", package: "com.acme.notes.debug" }))).toHaveLength(1);
  });
});

describe("attachSources", () => {
  it("annotates elements and resolves the activity file", async () => {
    const elements = [el({ id: "com.acme.notes:id/welcome_title", text: "Welcome back" })];
    const activity = await attachSources(elements, root, "com.acme.notes/.LoginActivity");
    expect(activity).toBe(`${LOGIN}:${lineOf(LOGIN, "class LoginActivity")}`);
    expect(elements[0].source).toBe(`${LAYOUT}:${lineOf(LAYOUT, "@+id/welcome_title")}`);
    expect(elements[0].sources?.length).toBeGreaterThan(1);
  });
});

describe("bindingName", () => {
  it("camel-cases view ids like ViewBinding does", () => {
    expect(bindingName("signup_button")).toBe("signupButton");
    expect(bindingName("item_2_title")).toBe("item2Title");
  });
});
