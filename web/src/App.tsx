import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { matchElements } from "../../src/shared/mapping";
import type { Box, Capture } from "../../src/shared/types";
import { Annotator } from "./Annotator";
import { api, type SendResult } from "./api";
import { blobToPngDataUrl, renderCapture } from "./images";
import { ScreenShare } from "./ScreenShare";

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const PASTE_KEY = isMac ? "⌘V" : "Ctrl+V";

function describeSource(c: Capture): string {
  if (c.source.kind === "url") return c.source.title || c.source.url || "Page";
  return c.source.title || { paste: "Pasted image", file: "Image file", screen: "Screen capture" }[c.source.kind];
}

function isAnnotated(c: Capture): boolean {
  return c.boxes.length > 0 || c.note.trim() !== "";
}

export function App() {
  const [drafts, setDrafts] = useState<Capture[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [focusBoxId, setFocusBoxId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("http://localhost:3000/");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [projectDir, setProjectDir] = useState("");
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const fileInput = useRef<HTMLInputElement>(null);
  // Latest drafts for the debounced save, which fires after the render that scheduled it.
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;

  const selected = drafts.find((d) => d.id === selectedId) ?? null;

  // ---------- loading & syncing ----------

  const refresh = useCallback(async () => {
    const remote = await api.drafts();
    setDrafts((local) => {
      // Local copies win (they may hold unsaved edits); remote adds new captures, e.g. from the agent.
      const byId = new Map(local.map((d) => [d.id, d]));
      return remote.map((r) => byId.get(r.id) ?? r);
    });
    setSelectedId((cur) => cur ?? remote[remote.length - 1]?.id ?? null);
  }, []);

  useEffect(() => {
    api.health().then((h) => setProjectDir(h.projectDir), () => {});
    refresh().catch((e) => setError(e.message));
    const t = setInterval(() => refresh().catch(() => {}), 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const patchDraft = useCallback((id: string, patch: { boxes?: Box[]; note?: string }) => {
    setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    const timers = saveTimers.current;
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        const d = draftsRef.current.find((x) => x.id === id);
        if (d) api.updateDraft(id, { boxes: d.boxes, note: d.note }).catch((e) => setError(e.message));
      }, 400),
    );
  }, []);

  const flushSaves = async () => {
    const pending = [...saveTimers.current.keys()];
    for (const id of pending) clearTimeout(saveTimers.current.get(id));
    saveTimers.current.clear();
    await Promise.all(
      drafts.filter((d) => pending.includes(d.id)).map((d) => api.updateDraft(d.id, { boxes: d.boxes, note: d.note })),
    );
  };

  // ---------- capturing ----------

  const addCapture = useCallback(async (work: () => Promise<Capture>, label: string) => {
    setBusy(label);
    setError(null);
    setSent(null);
    try {
      const c = await work();
      setDrafts((ds) => [...ds.filter((d) => d.id !== c.id), c]);
      setSelectedId(c.id);
      setSelectedBoxId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const addImageBlob = useCallback(
    (blob: Blob, kind: "paste" | "file", title?: string) =>
      addCapture(async () => api.createDraft(await blobToPngDataUrl(blob), { kind, title }), "Adding image…"),
    [addCapture],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const blob = item?.getAsFile();
      if (!blob) return;
      e.preventDefault();
      void addImageBlob(blob, "paste");
    };
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      for (const f of [...(e.dataTransfer?.files ?? [])]) if (f.type.startsWith("image/")) void addImageBlob(f, "file", f.name);
    };
    window.addEventListener("paste", onPaste);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [addImageBlob]);

  const startShare = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("This browser cannot share the screen. Open lookhere in Chrome, Edge, or Firefox, or paste a screenshot instead.");
      return;
    }
    try {
      setStream(await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }));
    } catch (e) {
      // NotAllowedError also covers the user cancelling the picker; only explain it when nothing was asked.
      const err = e as Error;
      setError(err.name === "NotAllowedError" ? "Screen sharing was cancelled or blocked." : err.message);
    }
  };
  const stopShare = useCallback(() => {
    setStream((s) => {
      s?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const captureFromUrl = (e: React.FormEvent) => {
    e.preventDefault();
    void addCapture(() => api.captureUrl(url.trim(), 1280, 800, false), "Capturing page…");
  };

  // ---------- editing ----------

  const setBoxes = (boxes: Box[]) => selected && patchDraft(selected.id, { boxes });

  const removeBox = (id: string) => {
    if (!selected) return;
    setBoxes(selected.boxes.filter((b) => b.id !== id));
    if (selectedBoxId === id) setSelectedBoxId(null);
  };

  const removeDraft = async (id: string) => {
    clearTimeout(saveTimers.current.get(id));
    saveTimers.current.delete(id);
    setDrafts((ds) => ds.filter((d) => d.id !== id));
    if (selectedId === id) setSelectedId(drafts.find((d) => d.id !== id)?.id ?? null);
    await api.deleteDraft(id).catch((e) => setError(e.message));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea");
      if (typing) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedBoxId) {
        e.preventDefault();
        removeBox(selectedBoxId);
      }
      if (e.key === "Escape") setSelectedBoxId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- sending ----------

  const toSend = drafts.filter(isAnnotated);
  const boxTotal = toSend.reduce((n, d) => n + d.boxes.length, 0);

  const sendAll = async () => {
    setBusy("Sending…");
    setError(null);
    try {
      await flushSaves();
      const captures = [];
      for (const d of toSend) captures.push({ captureId: d.id, ...(await renderCapture(d)) });
      const result = await api.send(message, captures);
      setSent(result);
      setCopied(false);
      setMessage("");
      const sentIds = new Set(toSend.map((d) => d.id));
      const rest = drafts.filter((d) => !sentIds.has(d.id));
      setDrafts(rest);
      setSelectedId(rest[0]?.id ?? null);
      setSelectedBoxId(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const copyMarkdown = async () => {
    if (!sent) return;
    try {
      await navigator.clipboard.writeText(sent.markdown);
      setCopied(true);
    } catch {
      setError("Clipboard is blocked. The same text is in feedback.md in the folder above.");
    }
  };

  const targetsByBox = useMemo(() => {
    const m = new Map<string, ReturnType<typeof matchElements>>();
    if (selected?.elements) for (const b of selected.boxes) m.set(b.id, matchElements(b.rect, selected.elements, 2));
    return m;
  }, [selected]);

  // ---------- view ----------

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" className="logo-frame" />
            <rect x="7" y="9" width="8" height="6" rx="1" className="logo-box" />
          </svg>
          <span>lookhere</span>
        </div>

        <div className="capture-bar" role="toolbar" aria-label="Capture">
          <span className="hint" title="Take a screenshot with your OS tool, then paste it here">
            Paste <kbd>{PASTE_KEY}</kbd>
          </span>
          <button onClick={() => fileInput.current?.click()}>Open image</button>
          <input
            ref={fileInput}
            id="file-input"
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              for (const f of [...(e.target.files ?? [])]) void addImageBlob(f, "file", f.name);
              e.target.value = "";
            }}
          />
          <button onClick={stream ? stopShare : startShare} aria-pressed={!!stream}>
            {stream ? "Stop sharing" : "Share screen"}
          </button>
          <form className="url-form" onSubmit={captureFromUrl}>
            <input
              id="capture-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-label="Page URL to capture"
              placeholder="http://localhost:3000/"
              required
            />
            <button type="submit" disabled={!!busy}>
              Capture URL
            </button>
          </form>
        </div>
        <div className="project" title={projectDir}>
          {projectDir}
        </div>
      </header>

      {(error || busy) && (
        <div className={error ? "status error" : "status"} role="status">
          {error ?? busy}
          {error && (
            <button className="ghost small" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <main className="layout">
        <aside className="tray" aria-label="Captures">
          <div className="panel-title">Captures</div>
          {drafts.length === 0 && <p className="muted small">Nothing captured yet.</p>}
          <ol>
            {drafts.map((d, i) => (
              <li key={d.id}>
                <button
                  className={d.id === selectedId ? "thumb active" : "thumb"}
                  onClick={() => {
                    setSelectedId(d.id);
                    setSelectedBoxId(null);
                  }}
                >
                  <img src={api.imageUrl(d.id)} alt="" />
                  <span className="thumb-meta">
                    <span className="thumb-title">
                      {i + 1}. {describeSource(d)}
                    </span>
                    <span className="muted small">
                      {d.boxes.length} box{d.boxes.length === 1 ? "" : "es"}
                      {d.elements ? " · DOM linked" : ""}
                    </span>
                  </span>
                </button>
                <button className="icon-btn" aria-label={`Delete capture ${i + 1}`} onClick={() => removeDraft(d.id)}>
                  ×
                </button>
              </li>
            ))}
          </ol>
        </aside>

        <section className="canvas" aria-label="Screenshot">
          {stream && (
            <ScreenShare
              stream={stream}
              onStop={stopShare}
              onFrame={(img, title) => void addCapture(() => api.createDraft(img, { kind: "screen", title }), "Adding frame…")}
            />
          )}
          {sent && (
            <div className="sent" role="status">
              <div>
                <strong>
                  Sent {sent.bundle.captures.length} screen{sent.bundle.captures.length === 1 ? "" : "s"} to your agent.
                </strong>{" "}
                It can pick them up now with <code>get_feedback</code>, or ask it to “check my lookhere feedback”.
                <div className="muted small">
                  Saved in <code>{sent.dir}</code>
                </div>
              </div>
              <div className="sent-actions">
                <button onClick={copyMarkdown}>{copied ? "Copied" : "Copy as Markdown"}</button>
                <button className="ghost" onClick={() => setSent(null)}>
                  Close
                </button>
              </div>
            </div>
          )}
          {selected ? (
            <Annotator
              key={selected.id}
              capture={selected}
              selectedBoxId={selectedBoxId}
              onSelectBox={setSelectedBoxId}
              onChangeBoxes={setBoxes}
              onCreatedBox={(id) => {
                setSelectedBoxId(id);
                setFocusBoxId(id);
              }}
            />
          ) : (
            !stream && (
              <div className="empty">
                <h1>Show your agent what you mean.</h1>
                <p>Capture a screen, drag a box over the part to change, and write what should change.</p>
                <ul className="ways">
                  <li>
                    <b>Paste</b> a screenshot with <kbd>{PASTE_KEY}</kbd>, or drop an image file here
                  </li>
                  <li>
                    <b>Share screen</b> to grab frames from any app, simulator, or emulator
                  </li>
                  <li>
                    <b>Capture URL</b> to also link each box to the page’s real elements
                  </li>
                </ul>
              </div>
            )
          )}
        </section>

        <aside className="notes" aria-label="Notes">
          {selected ? (
            <>
              <div className="panel-title">Boxes</div>
              {selected.boxes.length === 0 && <p className="muted small">Drag on the screenshot to draw a box.</p>}
              <ol className="box-list">
                {selected.boxes.map((b, i) => {
                  const targets = targetsByBox.get(b.id) ?? [];
                  return (
                    <li key={b.id} className={b.id === selectedBoxId ? "box-item active" : "box-item"} onClick={() => setSelectedBoxId(b.id)}>
                      <div className="box-head">
                        <span className="num">{i + 1}</span>
                        <button className="icon-btn" aria-label={`Delete box ${i + 1}`} onClick={() => removeBox(b.id)}>
                          ×
                        </button>
                      </div>
                      <textarea
                        id={`note-${b.id}`}
                        value={b.note}
                        placeholder="What should change here?"
                        rows={2}
                        ref={(el) => {
                          if (el && focusBoxId === b.id) {
                            el.focus();
                            setFocusBoxId(null);
                          }
                        }}
                        onFocus={() => setSelectedBoxId(b.id)}
                        onChange={(e) =>
                          setBoxes(selected.boxes.map((x) => (x.id === b.id ? { ...x, note: e.target.value } : x)))
                        }
                      />
                      {targets.length > 0 && (
                        <ul className="targets" aria-label="Elements under this box">
                          {targets.map((t) => (
                            <li key={t.element.selector} title={t.element.text}>
                              <code>{t.element.components?.[0] ?? `<${t.element.tag}>`}</code> {t.element.selector}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
              <label className="panel-title" htmlFor="screen-note">
                Note for this screen
              </label>
              <textarea
                id="screen-note"
                value={selected.note}
                placeholder="Optional"
                rows={3}
                onChange={(e) => patchDraft(selected.id, { note: e.target.value })}
              />
            </>
          ) : (
            <p className="muted small">Notes for the selected capture appear here.</p>
          )}
        </aside>
      </main>

      <footer className="sendbar">
        <textarea
          id="message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Anything else the agent should know? (optional)"
          rows={1}
        />
        <button className="primary send" onClick={sendAll} disabled={toSend.length === 0 || !!busy}>
          Send {toSend.length} screen{toSend.length === 1 ? "" : "s"} · {boxTotal} box{boxTotal === 1 ? "" : "es"}
        </button>
      </footer>
    </div>
  );
}
