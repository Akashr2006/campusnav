"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 360 viewer for a locally mirrored equirectangular panorama.
 *
 * Panning is a background offset rather than a CSS 3D scene: an equirect image
 * wraps horizontally by construction, so there are no stacking-context or
 * preserve-3d pitfalls, and it behaves identically in every browser.
 */
export function CubemapViewer({
  sceneIndex,
  className,
  onUnavailable,
}: {
  sceneIndex: number;
  className?: string;
  /** Fired when the local mirror has no imagery for this scene. */
  onUnavailable?: () => void;
}) {
  const [yaw, setYaw] = useState(0); // degrees, wraps at 360
  const [pitch, setPitch] = useState(0); // -90..90
  const [zoom, setZoom] = useState(1); // 1 = 120deg horizontal field of view
  const [ready, setReady] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  useEffect(() => {
    setYaw(0);
    setPitch(0);
    setReady(false);
  }, [sceneIndex]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, yaw, pitch };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !size.w) return;
    const fov = 120 / zoom;
    const degPerPx = fov / size.w;
    setYaw(drag.current.yaw - (e.clientX - drag.current.x) * degPerPx);
    setPitch(
      Math.max(-70, Math.min(70, drag.current.pitch - (e.clientY - drag.current.y) * degPerPx))
    );
  };

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  // The panorama is drawn at `scale` times the viewport width per 360 degrees.
  const fov = 120 / zoom;
  const fullWidth = size.w ? (size.w * 360) / fov : 0;
  const fullHeight = fullWidth / 2;
  const offsetX = -((((yaw % 360) + 360) % 360) / 360) * fullWidth;
  const offsetY = (pitch / 180) * fullHeight;

  return (
    <div
      ref={boxRef}
      className={className}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={(e) => setZoom((z) => Math.max(0.6, Math.min(3, z - Math.sign(e.deltaY) * 0.15)))}
      style={{
        overflow: "hidden",
        background: "#000",
        touchAction: "none",
        cursor: drag.current ? "grabbing" : "grab",
      }}
      role="img"
      aria-label="360 degree panorama; drag to look around"
    >
      {fullWidth > 0 &&
        /* Two copies side by side so the seam is never visible while panning. */
        [0, 1].map((copy) => (
          <img
            key={copy}
            src={`/tour/${sceneIndex}/pano.jpg`}
            alt=""
            draggable={false}
            onLoad={() => setReady(true)}
            onError={onUnavailable}
            style={{
              position: "absolute",
              maxWidth: "none",
              width: fullWidth,
              height: fullHeight,
              left: offsetX + copy * fullWidth,
              top: size.h / 2 - fullHeight / 2 + offsetY,
              userSelect: "none",
            }}
          />
        ))}

      {!ready && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-3 text-sm text-white/70">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />
          Loading panorama…
        </div>
      )}
    </div>
  );
}
