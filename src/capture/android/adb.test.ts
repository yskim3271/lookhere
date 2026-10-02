import { describe, expect, it } from "vitest";
import { adbCandidates, parseDevices, parseFocusedActivity } from "./adb.js";

describe("parseDevices", () => {
  it("reads serial, state, and model from `adb devices -l`", () => {
    const out = [
      "List of devices attached",
      "emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1",
      "R5CT1234567            unauthorized usb:1-1 transport_id:2",
      "192.168.0.7:5555       offline",
      "",
    ].join("\r\n");
    expect(parseDevices(out)).toEqual([
      { serial: "emulator-5554", state: "device", model: "sdk gphone64 x86 64", product: "sdk_gphone64_x86_64" },
      { serial: "R5CT1234567", state: "unauthorized", model: undefined, product: undefined },
      { serial: "192.168.0.7:5555", state: "offline", model: undefined, product: undefined },
    ]);
  });

  it("returns nothing when no device is attached", () => {
    expect(parseDevices("List of devices attached\n\n")).toEqual([]);
  });
});

describe("parseFocusedActivity", () => {
  it("shortens activities inside the app package", () => {
    const dumpsys =
      "  mCurrentFocus=Window{25ad0cb u0 com.android.settings/com.android.settings.homepage.SettingsHomepageActivity}\n";
    expect(parseFocusedActivity(dumpsys)).toBe("com.android.settings/.homepage.SettingsHomepageActivity");
  });

  it("keeps activities from another package as is", () => {
    expect(parseFocusedActivity("mCurrentFocus=Window{1 u0 com.acme/org.lib.Host}")).toBe("com.acme/org.lib.Host");
  });

  it("returns undefined without a focused window", () => {
    expect(parseFocusedActivity("mCurrentFocus=null")).toBeUndefined();
  });
});

describe("adbCandidates", () => {
  it("tries LOOKHERE_ADB and the SDK folders before PATH", () => {
    const c = adbCandidates({ LOOKHERE_ADB: "/custom/adb", ANDROID_HOME: "/sdk" });
    expect(c[0]).toBe("/custom/adb");
    expect(c[1].replace(/\\/g, "/")).toMatch(/^\/sdk\/platform-tools\/adb(\.exe)?$/);
  });
});
