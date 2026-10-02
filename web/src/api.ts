import type { Box, Bundle, Capture } from "../../src/shared/types";

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export interface AndroidDevice {
  serial: string;
  state: string;
  model?: string;
}

export interface SendResult {
  bundle: Bundle;
  markdown: string;
  dir: string;
}

export const api = {
  health: () => call<{ projectDir: string }>("GET", "/api/health"),
  drafts: () => call<Capture[]>("GET", "/api/drafts"),
  createDraft: (image: string, source: { kind: "paste" | "file" | "screen"; title?: string }) =>
    call<Capture>("POST", "/api/drafts", { image, source }),
  updateDraft: (id: string, patch: { boxes?: Box[]; note?: string }) => call<Capture>("PUT", `/api/drafts/${id}`, patch),
  deleteDraft: (id: string) => call<{ ok: true }>("DELETE", `/api/drafts/${id}`),
  captureUrl: (url: string, width: number, height: number, fullPage: boolean) =>
    call<Capture>("POST", "/api/capture-url", { url, width, height, fullPage }),
  androidDevices: () => call<AndroidDevice[]>("GET", "/api/android/devices"),
  captureAndroid: (serial?: string) => call<Capture & { warning?: string }>("POST", "/api/capture-android", { serial }),
  send: (message: string, captures: { captureId: string; annotated: string; crops: Record<string, string> }[]) =>
    call<SendResult>("POST", "/api/send", { message, captures }),
  imageUrl: (id: string) => `/api/drafts/${id}/image`,
};
