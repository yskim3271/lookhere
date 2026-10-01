import { useEffect, useRef, useState } from "react";

interface Props {
  stream: MediaStream;
  onFrame(dataUrl: string, title: string): void;
  onStop(): void;
}

/**
 * Live preview of a shared window/screen. The user can keep using that app
 * (open a menu, switch a simulator screen) and grab frames whenever it looks right.
 */
export function ScreenShare({ stream, onFrame, onStop }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const track = stream.getVideoTracks()[0];
  const title = track?.label ?? "Shared screen";

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.srcObject = stream;
    void v.play();
    const ended = () => onStop();
    track?.addEventListener("ended", ended);
    return () => track?.removeEventListener("ended", ended);
  }, [stream, track, onStop]);

  const grab = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    onFrame(c.toDataURL("image/png"), title);
  };

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      grab();
      setCountdown(null);
      return;
    }
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
    // grab reads the latest frame from the video element; no need to depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  return (
    <section className="share" aria-label="Screen share">
      <div className="share-head">
        <span className="live-dot" aria-hidden="true" />
        <span className="share-title" title={title}>
          Sharing: {title}
        </span>
      </div>
      <video ref={videoRef} muted playsInline />
      <div className="share-actions">
        <button className="primary" onClick={grab} disabled={countdown !== null}>
          Capture frame
        </button>
        <button onClick={() => setCountdown(3)} disabled={countdown !== null}>
          {countdown !== null ? `Capturing in ${countdown}…` : "Capture in 3 s"}
        </button>
        <button className="ghost" onClick={onStop}>
          Stop sharing
        </button>
      </div>
    </section>
  );
}
