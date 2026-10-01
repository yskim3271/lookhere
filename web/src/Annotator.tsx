import { useEffect, useRef, useState } from "react";
import { clampRect, normalizeRect } from "../../src/shared/mapping";
import type { Box, Capture, Rect } from "../../src/shared/types";
import { api } from "./api";
import { BADGE_R, badgePosition } from "./images";

type Drag =
  | { kind: "draw"; start: { x: number; y: number }; rect: Rect }
  | { kind: "move"; id: string; start: { x: number; y: number }; orig: Rect }
  | { kind: "resize"; id: string; corner: "nw" | "ne" | "sw" | "se"; orig: Rect };

const MIN_SIZE = 8;

/**
 * Fit the whole screenshot in view (phone screens, desktop windows). Very tall
 * full-page captures keep the column width and scroll instead of shrinking to a sliver.
 */
function fitWidth(width: number, height: number): string {
  return height / width > 3 ? "100%" : `min(100%, calc((100vh - 190px) * ${(width / height).toFixed(4)}))`;
}

export function newBoxId(): string {
  return Math.random().toString(36).slice(2, 10);
}

interface Props {
  capture: Capture;
  selectedBoxId: string | null;
  onSelectBox(id: string | null): void;
  onChangeBoxes(boxes: Box[]): void;
  onCreatedBox(id: string): void;
}

/** The screenshot with an SVG overlay in image-pixel coordinates for drawing and editing boxes. */
export function Annotator({ capture, selectedBoxId, onSelectBox, onChangeBoxes, onCreatedBox }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // Image pixels per screen pixel, so handles and badges keep a constant on-screen size.
  const [k, setK] = useState(1);
  const { width, height } = capture.image;

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const ro = new ResizeObserver(() => setK(width / Math.max(1, svg.getBoundingClientRect().width)));
    ro.observe(svg);
    return () => ro.disconnect();
  }, [width]);

  const toImage = (e: React.PointerEvent): { x: number; y: number } => {
    const svg = svgRef.current!;
    const r = svg.getBoundingClientRect();
    return {
      x: Math.min(width, Math.max(0, ((e.clientX - r.left) / r.width) * width)),
      y: Math.min(height, Math.max(0, ((e.clientY - r.top) / r.height) * height)),
    };
  };

  const boxes = capture.boxes;
  const replace = (id: string, rect: Rect) =>
    onChangeBoxes(boxes.map((b) => (b.id === id ? { ...b, rect: clampRect(normalizeRect(rect), width, height) } : b)));

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const target = e.target as Element;
    const p = toImage(e);
    const boxId = target.closest("[data-box]")?.getAttribute("data-box");
    const corner = target.getAttribute("data-corner") as "nw" | "ne" | "sw" | "se" | null;
    svgRef.current!.setPointerCapture(e.pointerId);
    if (boxId && corner) {
      const b = boxes.find((x) => x.id === boxId)!;
      setDrag({ kind: "resize", id: boxId, corner, orig: b.rect });
    } else if (boxId) {
      const b = boxes.find((x) => x.id === boxId)!;
      onSelectBox(boxId);
      setDrag({ kind: "move", id: boxId, start: p, orig: b.rect });
    } else {
      onSelectBox(null);
      setDrag({ kind: "draw", start: p, rect: { x: p.x, y: p.y, w: 0, h: 0 } });
    }
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toImage(e);
    if (drag.kind === "draw") {
      setDrag({ ...drag, rect: { x: drag.start.x, y: drag.start.y, w: p.x - drag.start.x, h: p.y - drag.start.y } });
    } else if (drag.kind === "move") {
      const dx = p.x - drag.start.x;
      const dy = p.y - drag.start.y;
      const x = Math.min(Math.max(0, drag.orig.x + dx), width - drag.orig.w);
      const y = Math.min(Math.max(0, drag.orig.y + dy), height - drag.orig.h);
      replace(drag.id, { ...drag.orig, x, y });
    } else {
      const o = drag.orig;
      const left = drag.corner.includes("w") ? p.x : o.x;
      const right = drag.corner.includes("e") ? p.x : o.x + o.w;
      const top = drag.corner.includes("n") ? p.y : o.y;
      const bottom = drag.corner.includes("s") ? p.y : o.y + o.h;
      replace(drag.id, { x: left, y: top, w: right - left, h: bottom - top });
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "draw") {
      const rect = clampRect(normalizeRect(drag.rect), width, height);
      if (rect.w >= MIN_SIZE * k && rect.h >= MIN_SIZE * k) {
        const id = newBoxId();
        onChangeBoxes([...boxes, { id, rect, note: "" }]);
        onCreatedBox(id);
      }
    }
    setDrag(null);
  };

  const drawing = drag?.kind === "draw" ? normalizeRect(drag.rect) : null;
  const badge = BADGE_R * k;
  const handle = 5 * k;

  return (
    <div className="stage">
      <div className="stage-inner" style={{ aspectRatio: `${width} / ${height}`, width: fitWidth(width, height) }}>
        <img src={api.imageUrl(capture.id)} alt="Captured screen" draggable={false} />
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => setDrag(null)}
          role="application"
          aria-label="Drag on the screenshot to draw a box"
        >
          {boxes.map((b, i) => {
            const sel = b.id === selectedBoxId;
            const { x, y, w, h } = b.rect;
            const bp = badgePosition(b.rect, badge, width, height);
            return (
              <g key={b.id} data-box={b.id} className={sel ? "box selected" : "box"}>
                <title>{b.note || `Box ${i + 1}`}</title>
                <rect className="box-hit" x={x} y={y} width={w} height={h} />
                <rect className="box-halo" x={x} y={y} width={w} height={h} vectorEffect="non-scaling-stroke" />
                <rect className="box-line" x={x} y={y} width={w} height={h} vectorEffect="non-scaling-stroke" />
                <circle className="badge" cx={bp.x} cy={bp.y} r={badge} />
                <text className="badge-text" x={bp.x} y={bp.y} fontSize={14 * k} dy="0.35em" textAnchor="middle">
                  {i + 1}
                </text>
                {sel &&
                  (
                    [
                      ["nw", x, y],
                      ["ne", x + w, y],
                      ["sw", x, y + h],
                      ["se", x + w, y + h],
                    ] as const
                  ).map(([corner, cx, cy]) => (
                    <rect
                      key={corner}
                      data-corner={corner}
                      className={`handle handle-${corner}`}
                      x={cx - handle}
                      y={cy - handle}
                      width={handle * 2}
                      height={handle * 2}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
              </g>
            );
          })}
          {drawing && (
            <rect className="box-line drawing" x={drawing.x} y={drawing.y} width={drawing.w} height={drawing.h} vectorEffect="non-scaling-stroke" />
          )}
        </svg>
      </div>
    </div>
  );
}
