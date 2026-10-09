"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { canvasHasInk, cropToInk } from "@/lib/signature-image";

interface SignaturePadProps {
  onSign: (dataUrl: string) => void;
  width?: number;
  height?: number;
  label?: string;
}

export default function SignaturePad({
  onSign,
  width = 400,
  height = 200,
  label = "Sign here",
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [error, setError] = useState("");

  const getPos = useCallback((e: MouseEvent | Touch) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // The canvas is displayed at up to `width` CSS pixels but defaults to a
    // 300x150 backing store, so on a Retina screen every stroke was upscaled and
    // looked like a hairline. Match the store to the device pixel ratio instead.
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = "#1a1a2e";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const startDraw = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      setDrawing(true);
      const pos = "touches" in e ? getPos(e.touches[0]) : getPos(e);
      ctx.beginPath();
      ctx.moveTo(pos.x, pos.y);
    };

    const draw = (e: MouseEvent | TouchEvent) => {
      if (!drawing) return;
      e.preventDefault();
      const pos = "touches" in e ? getPos(e.touches[0]) : getPos(e);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    };

    const stopDraw = () => setDrawing(false);

    canvas.addEventListener("mousedown", startDraw);
    canvas.addEventListener("mousemove", draw);
    canvas.addEventListener("mouseup", stopDraw);
    canvas.addEventListener("mouseleave", stopDraw);
    canvas.addEventListener("touchstart", startDraw, { passive: false });
    canvas.addEventListener("touchmove", draw, { passive: false });
    canvas.addEventListener("touchend", stopDraw);

    return () => {
      canvas.removeEventListener("mousedown", startDraw);
      canvas.removeEventListener("mousemove", draw);
      canvas.removeEventListener("mouseup", stopDraw);
      canvas.removeEventListener("mouseleave", stopDraw);
      canvas.removeEventListener("touchstart", startDraw);
      canvas.removeEventListener("touchmove", draw);
      canvas.removeEventListener("touchend", stopDraw);
    };
  }, [drawing, getPos, width, height]);

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    setError("");
  };

  const submit = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Refuse to record a blank signature: an empty box stored as "signed" is
    // worse than no signature, because nothing on the consent shows the gap.
    if (!canvasHasInk(canvas)) {
      setError("Ask the guest to sign in the box before accepting.");
      return;
    }
    setError("");
    onSign(cropToInk(canvas));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#647993" }}>{label}</span>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        style={{
          border: "2px solid #e2e8f0",
          borderRadius: 10,
          cursor: "crosshair",
          background: "#fff",
          touchAction: "none",
          width: "100%",
          maxWidth: width,
        }}
      />
      {error && (
        <span style={{ fontSize: 12, fontWeight: 700, color: "#b02a37" }}>{error}</span>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={clear}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
            background: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={submit}
          style={{
            padding: "6px 14px",
            borderRadius: 8,
            border: "1px solid #075eb7",
            background: "#075eb7",
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Accept Signature
        </button>
      </div>
    </div>
  );
}
