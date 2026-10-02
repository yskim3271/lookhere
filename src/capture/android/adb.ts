import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { CaptureSource, ElementInfo } from "../../shared/types.js";
import { hierarchyToElements, parseHierarchy } from "./hierarchy.js";
import { attachSources } from "./locate.js";

const EXE = process.platform === "win32" ? "adb.exe" : "adb";

/** Places adb usually lives, in the order we try them. PATH comes last via a bare "adb". */
export function adbCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  if (env.LOOKHERE_ADB) out.push(env.LOOKHERE_ADB);
  for (const root of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) {
    if (root) out.push(path.join(root, "platform-tools", EXE));
  }
  if (process.platform === "win32" && env.LOCALAPPDATA) {
    out.push(path.join(env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", EXE));
    // `winget install Google.PlatformTools`
    const winget = path.join(env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
    try {
      for (const dir of readdirSync(winget)) {
        if (dir.startsWith("Google.PlatformTools")) out.push(path.join(winget, dir, "platform-tools", EXE));
      }
    } catch {
      // no winget packages folder
    }
  } else if (process.platform === "darwin") {
    out.push(path.join(homedir(), "Library", "Android", "sdk", "platform-tools", EXE));
  } else {
    out.push(path.join(homedir(), "Android", "Sdk", "platform-tools", EXE));
  }
  return out;
}

let cachedAdb: string | undefined;

export function findAdb(): string {
  if (cachedAdb) return cachedAdb;
  cachedAdb = adbCandidates().find((p) => existsSync(p)) ?? "adb";
  return cachedAdb;
}

function adb(args: string[], opts: { binary?: boolean; timeoutMs?: number } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      findAdb(),
      args,
      { encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: opts.timeoutMs ?? 20_000, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ENOENT") {
            reject(new Error("adb not found. Install Android SDK platform-tools or set ANDROID_HOME / LOOKHERE_ADB."));
          } else {
            reject(new Error(`adb ${args.join(" ")} failed: ${stderr.toString().trim() || err.message}`));
          }
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export interface AndroidDevice {
  serial: string;
  /** "device" when usable; also "unauthorized", "offline", ... */
  state: string;
  model?: string;
  product?: string;
}

/** Parses `adb devices -l`. */
export function parseDevices(output: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions|authorizing|connecting)\b(.*)$/.exec(line.trim());
    if (!m || line.startsWith("List of devices")) continue;
    const extra = Object.fromEntries([...m[3].matchAll(/(\w+):(\S+)/g)].map((x) => [x[1], x[2]]));
    devices.push({ serial: m[1], state: m[2], model: extra.model?.replace(/_/g, " "), product: extra.product });
  }
  return devices;
}

export async function listDevices(): Promise<AndroidDevice[]> {
  return parseDevices((await adb(["devices", "-l"])).toString("utf8"));
}

/** Resolves which device to use, with an error that says how to fix the situation. */
export async function pickDevice(serial?: string): Promise<AndroidDevice> {
  const devices = await listDevices();
  if (serial) {
    const d = devices.find((x) => x.serial === serial);
    if (!d) throw new Error(`Android device ${serial} is not connected.`);
    if (d.state !== "device") throw new Error(`Android device ${serial} is ${d.state}. ${stateHint(d.state)}`);
    return d;
  }
  const ready = devices.filter((d) => d.state === "device");
  if (ready.length === 1) return ready[0];
  if (ready.length > 1) {
    throw new Error(`Several Android devices are connected (${ready.map((d) => d.serial).join(", ")}). Choose one.`);
  }
  const blocked = devices[0];
  if (blocked) throw new Error(`Android device ${blocked.serial} is ${blocked.state}. ${stateHint(blocked.state)}`);
  throw new Error("No Android device found. Start an emulator or connect a phone with USB debugging on.");
}

function stateHint(state: string): string {
  if (state === "unauthorized") return "Accept the USB debugging prompt on the device.";
  if (state === "offline") return "Reconnect the device or restart adb (adb kill-server).";
  return "";
}

/** Parses the focused window from `dumpsys window`, e.g. "com.android.settings/.homepage.SettingsHomepageActivity". */
export function parseFocusedActivity(dumpsys: string): string | undefined {
  const m = /mCurrentFocus=Window\{\S+ \S+ ([^}\s]+)\}/.exec(dumpsys) ?? /mFocusedApp=.*? ([\w.]+\/[\w.$]+)/.exec(dumpsys);
  if (!m) return undefined;
  const [pkg, cls] = m[1].split("/");
  if (!cls) return m[1];
  return `${pkg}/${cls.startsWith(pkg + ".") ? cls.slice(pkg.length) : cls}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Dumps the UI hierarchy straight to stdout. Fails while the screen is still changing
 * ("null root node", "could not get idle state"), so it retries a few times.
 */
export async function dumpHierarchy(serial: string, attempts = 3): Promise<string> {
  let last = "";
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(1500);
    try {
      const out = (await adb(["-s", serial, "exec-out", "uiautomator", "dump", "/dev/tty"], { timeoutMs: 15_000 })).toString("utf8");
      if (out.includes("<hierarchy")) return out;
      last = out.trim();
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`Could not read the screen's UI tree: ${last || "no output"}`);
}

export async function screencap(serial: string): Promise<Buffer> {
  const png = await adb(["-s", serial, "exec-out", "screencap", "-p"], { binary: true });
  if (png.subarray(1, 4).toString() !== "PNG") throw new Error("screencap did not return a PNG");
  return png;
}

export interface AndroidCapture {
  png: Buffer;
  source: CaptureSource;
  elements: ElementInfo[];
  /** Set when the UI tree could not be read; the screenshot is still usable. */
  warning?: string;
}

/**
 * Captures the current screen with its UI tree. The tree is read first and the screenshot
 * right after, so both describe the same moment (the tree read is the slow, flaky part).
 */
export async function captureAndroid(opts: { serial?: string; projectDir?: string } = {}): Promise<AndroidCapture> {
  const device = await pickDevice(opts.serial);
  let elements: ElementInfo[] = [];
  let warning: string | undefined;
  try {
    elements = hierarchyToElements(parseHierarchy(await dumpHierarchy(device.serial)));
  } catch (e) {
    warning = `${(e as Error).message}. Captured the screenshot without element info.`;
  }
  const png = await screencap(device.serial);
  const activity = parseFocusedActivity((await adb(["-s", device.serial, "shell", "dumpsys", "window"]).catch(() => Buffer.from(""))).toString("utf8"));

  // Point each element at the project's source when we are run from an Android project.
  const activitySource = opts.projectDir && elements.length ? await attachSources(elements, opts.projectDir, activity) : undefined;

  return {
    png,
    elements,
    warning,
    source: {
      kind: "android",
      title: activity ?? device.model ?? device.serial,
      device: { serial: device.serial, ...(device.model ? { model: device.model } : {}) },
      ...(activity ? { activity } : {}),
      ...(activitySource ? { activitySource } : {}),
    },
  };
}
