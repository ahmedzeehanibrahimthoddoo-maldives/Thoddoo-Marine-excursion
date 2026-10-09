"use client";

import { useRef, useEffect, useCallback } from "react";
import { cropToInk } from "@/lib/signature-image";

interface SignCanvasProps {
  onSign: (dataUrl: string) => void;
  label?: string;
}

const INK = "#0b2f5c";
const STROKE = 2.2;

const canvasStyle = {
  width: "100%",
  height: 120,
  borderRadius: 10,
  background: "#fff",
  touchAction: "none" as const,
  cursor: "crosshair",
};

const btnStyle = {
  marginTop: "0.4rem",
  background: "none",
  border: "1.5px solid #dde6ef",
  borderRadius: 8,
  padding: "0.3rem 0.9rem",
  fontSize: "0.75rem",
  fontWeight: 700,
  color: "#6b7c8d",
  cursor: "pointer",
  fontFamily: "inherit",
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
};

const hintStyle = {
  fontSize: "0.7rem",
  color: "#9ba8b5",
  marginTop: "0.3rem",
  textAlign: "center" as const,
};

export default function SignCanvas({ onSign, label }: SignCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const hasDrawn = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const onSignRef = useRef(onSign);
  onSignRef.current = onSign;

  // Coordinates in CSS pixels. The context is pre-scaled by the device pixel
  // ratio, so every drawing call below works in the same units — mixing the two
  // is what previously squashed signatures into the top-left corner.
  const getPos = useCallback((e: PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  const emit = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && hasDrawn.current) {
      onSignRef.current(cropToInk(canvas));
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /**
     * Match the backing store to the box's real size on screen.
     *
     * Setting canvas.width/height wipes the bitmap, so anything already drawn is
     * copied across first: rotating a phone or opening the on-screen keyboard
     * resizes the box, and the guest should not lose the signature they just drew.
     */
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextW = Math.max(1, Math.round(rect.width * dpr));
      const nextH = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width === nextW && canvas.height === nextH) return;

      const oldW = canvas.width;
      const oldH = canvas.height;
      let snapshot: HTMLCanvasElement | null = null;
      if (oldW > 0 && oldH > 0 && hasDrawn.current) {
        snapshot = document.createElement("canvas");
        snapshot.width = oldW;
        snapshot.height = oldH;
        snapshot.getContext("2d")?.drawImage(canvas, 0, 0);
      }

      canvas.width = nextW;
      canvas.height = nextH;
      // setTransform, not scale: a second scale would compound with the first.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = INK;
      ctx.lineWidth = STROKE;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (snapshot) {
        ctx.drawImage(snapshot, 0, 0, oldW, oldH, 0, 0, rect.width, rect.height);
      }
    };

    fit();

    const strokeTo = (pos: { x: number; y: number }) => {
      const from = lastPoint.current ?? pos;
      // Phones report far fewer move events than a finger produces, so join the
      // reported points instead of drawing straight chords between them.
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
      lastPoint.current = pos;
      hasDrawn.current = true;
    };

    const onStart = (e: PointerEvent) => {
      e.preventDefault();
      drawing.current = true;
      // Capture the pointer so a finger that slides off the box keeps drawing
      // instead of cutting the signature short at the edge.
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Older browsers: the stroke still works, it just stops at the edge.
      }
      const pos = getPos(e);
      lastPoint.current = pos;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, STROKE / 2, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      hasDrawn.current = true;
    };

    const onMove = (e: PointerEvent) => {
      if (!drawing.current) return;
      e.preventDefault();
      const batch = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      if (batch.length > 0) {
        for (const point of batch) strokeTo(getPos(point));
      } else {
        strokeTo(getPos(e));
      }
    };

    const onEnd = (e: PointerEvent) => {
      if (!drawing.current) return;
      drawing.current = false;
      lastPoint.current = null;
      try {
        if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      } catch {
        // Nothing to release.
      }
      emit();
    };

    canvas.addEventListener("pointerdown", onStart);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onEnd);
    canvas.addEventListener("pointercancel", onEnd);

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit()) : null;
    observer?.observe(canvas);

    return () => {
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", onStart);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onEnd);
      canvas.removeEventListener("pointercancel", onEnd);
    };
  }, [getPos, emit]);

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Clear the whole backing store, not the pre-scaled region.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasDrawn.current = false;
    lastPoint.current = null;
    onSign("");
  };

  return (
    <div className="sign-canvas-wrap">
      <canvas ref={canvasRef} style={canvasStyle} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <p style={hintStyle}>{label ? `Sign above (${label})` : "Sign above"}</p>
        <button type="button" style={btnStyle} onClick={handleClear}>
          Clear
        </button>
      </div>
    </div>
  );
}