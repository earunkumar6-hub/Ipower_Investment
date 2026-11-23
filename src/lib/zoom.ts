// Application zoom (header − / % / + buttons): scales the root font size, which every rem-based size follows.
// Remembered per browser; the inline script in the root layout applies it before the first paint (no jump on load).

export const ZOOM_KEY = "ipower-zoom";
export const ZOOM_MIN = 80;
export const ZOOM_MAX = 150;
export const ZOOM_STEP = 10;
export const ZOOM_DEFAULT = 100;

/** A stored / requested value as a valid zoom percent (multiple of the step, inside the range). */
export const clampZoom = (v: unknown) => {
  const n = Math.round(Number(v) / ZOOM_STEP) * ZOOM_STEP;
  return Number.isFinite(n) ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) : ZOOM_DEFAULT;
};

/** Runs in <head> before the page paints. */
export const ZOOM_SCRIPT = `try{var z=parseInt(localStorage.getItem(${JSON.stringify(ZOOM_KEY)}),10);if(z>=${ZOOM_MIN}&&z<=${ZOOM_MAX})document.documentElement.style.fontSize=z+"%"}catch(e){}`;
