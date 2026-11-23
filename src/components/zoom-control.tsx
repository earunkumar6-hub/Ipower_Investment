"use client";

import { useSyncExternalStore } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clampZoom, ZOOM_DEFAULT, ZOOM_KEY, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "@/lib/zoom";

const EVENT = "ipower-zoom-change";

function read() {
  try { return clampZoom(localStorage.getItem(ZOOM_KEY) ?? ZOOM_DEFAULT); } catch { return ZOOM_DEFAULT; }
}
function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb); // another tab changed it
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", cb); };
}
function apply(percent: number) {
  document.documentElement.style.fontSize = `${percent}%`;
  try { localStorage.setItem(ZOOM_KEY, String(percent)); } catch { /* private window: zoom lasts until reload */ }
  window.dispatchEvent(new Event(EVENT));
}

/** − / 100% / + in the page header: zooms the whole application (80–150%); the % button goes back to 100%. */
export function ZoomControl() {
  const zoom = useSyncExternalStore(subscribe, read, () => ZOOM_DEFAULT);
  return (
    <div className="flex items-center gap-0.5 rounded-full border bg-white p-0.5" role="group" aria-label="Zoom">
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom <= ZOOM_MIN} onClick={() => apply(clampZoom(zoom - ZOOM_STEP))}>
        <Minus />
      </Button>
      <Button type="button" variant="ghost" size="sm" className="min-w-12 px-1 tabular-nums" aria-label="Reset zoom to 100%" title="Reset zoom" onClick={() => apply(ZOOM_DEFAULT)}>
        {zoom}%
      </Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom >= ZOOM_MAX} onClick={() => apply(clampZoom(zoom + ZOOM_STEP))}>
        <Plus />
      </Button>
    </div>
  );
}
