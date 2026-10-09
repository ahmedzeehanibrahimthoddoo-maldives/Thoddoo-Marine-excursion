/**
 * Shared image handling for the signature pads.
 *
 * Both the guest pad (app/rental/[token]/SignCanvas.tsx) and the staff pad
 * (app/admin/components/SignaturePad.tsx) draw into a wide canvas that is mostly
 * empty. The consent PDF drops whatever arrives into a fixed 70x20mm frame, so
 * exporting the whole box shrank a real signature down to a thin line floating in
 * white space. Cropping to the drawn bounds first means the same signature fills
 * the frame on the printed consent.
 *
 * Browser-only: callers are client components and this runs on pointer events.
 */

/**
 * Return a PNG data URL of the canvas trimmed to its ink, plus a small margin.
 * Falls back to the uncropped canvas if the pixels cannot be read.
 */
export function cropToInk(canvas: HTMLCanvasElement): string {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || w === 0 || h === 0) return canvas.toDataURL("image/png");

  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // A tainted canvas cannot be read back; the full box is still valid.
    return canvas.toDataURL("image/png");
  }

  const px = data.data;
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (px[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return canvas.toDataURL("image/png");

  const pad = Math.round(Math.max(w, h) * 0.02) + 4;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  out.getContext("2d")?.drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

/** True when the canvas holds more than a single stray tap. */
export function canvasHasInk(canvas: HTMLCanvasElement): boolean {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || w === 0 || h === 0) return false;
  let data: ImageData;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    // Cannot inspect: assume the guest meant it, since they drew something.
    return true;
  }
  const px = data.data;
  let painted = 0;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i] > 8) painted++;
    // A dot is a dot; anything past a small blob is a real signature.
    if (painted > 64) return true;
  }
  return false;
}