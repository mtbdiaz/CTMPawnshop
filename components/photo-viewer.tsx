"use client"; // runs in the browser: it opens a popup and reacts to clicks, keys and dragging

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./icons";

// PV1 (Wush, Nov 11): item photos open in a popup on the same page instead of a new browser tab.
// The page behind is dimmed and blurred. Zoom in and out, drag to move around a zoomed photo,
// and go to the previous / next photo. Esc, the X or a click outside the photo closes it.

export type ViewerPhoto = { url: string; alt: string }; // url = the photo (a signed link or a local preview), alt = what it shows

const ZOOMS = [1, 1.5, 2, 3, 4]; // 1 = the whole photo fits the popup

/** The popup. index = which photo is open (null = closed). */
export function PhotoViewer({ photos, index, onIndex }: { photos: ViewerPhoto[]; index: number | null; onIndex: (i: number | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null); // the <dialog>
  const closeBtn = useRef<HTMLButtonElement>(null); // the X, which gets the keyboard when the popup opens
  const box = useRef<HTMLDivElement>(null); // the area the photo sits in (it scrolls when zoomed)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null); // where a drag started
  const [zoomStep, setZoomStep] = useState(0); // position in ZOOMS
  const [fitWidth, setFitWidth] = useState(0); // PV2: how wide the photo is at "Fit", so 200% really is twice that size
  const zoom = ZOOMS[zoomStep];
  const open = index !== null && photos[index] !== undefined;
  const photo = open ? photos[index] : null;

  // open or close the real popup when index changes. showModal = on top of everything, the rest can't be clicked
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      closeBtn.current?.focus(); // keyboard starts on the X (Tab reaches the zoom and next buttons)
    }
    if (!open && d.open) d.close();
  }, [open]);

  // every photo starts at "fit" (no zoom)
  useEffect(() => setZoomStep(0), [index]); // eslint-disable-line react-hooks/set-state-in-effect -- reset when another photo opens

  const go = (step: number) => {
    if (index === null || photos.length < 2) return;
    onIndex((index + step + photos.length) % photos.length); // wraps around: after the last comes the first
  };
  // PV2: remember the "Fit" width before zooming in (measured from the photo on screen)
  const rememberFit = () => {
    const img = box.current?.querySelector("img");
    if (img && zoom === 1) setFitWidth(img.getBoundingClientRect().width);
  };
  const zoomBy = (step: number) => {
    rememberFit();
    setZoomStep((z) => Math.min(ZOOMS.length - 1, Math.max(0, z + step)));
  };
  // PV2: after zooming, keep the middle of the photo in the middle of the screen
  useLayoutEffect(() => {
    const b = box.current;
    if (!b || zoom === 1) return;
    b.scrollLeft = (b.scrollWidth - b.clientWidth) / 2;
    b.scrollTop = (b.scrollHeight - b.clientHeight) / 2;
  }, [zoom]);

  // keys: ← → photos, + − zoom, 0 back to fit. Esc is handled by the browser (it closes the dialog)
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "+" || e.key === "=") zoomBy(1);
    else if (e.key === "-") zoomBy(-1);
    else if (e.key === "0") setZoomStep(0);
    else return;
    e.preventDefault();
  }

  // drag a zoomed photo to see another part of it (mouse, pen or finger)
  function onPointerDown(e: React.PointerEvent) {
    if (zoom === 1 || !box.current) return;
    drag.current = { x: e.clientX, y: e.clientY, left: box.current.scrollLeft, top: box.current.scrollTop, moved: false };
    (e.target as Element).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || !box.current) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true; // a real drag, not a click
    box.current.scrollLeft = d.left - dx;
    box.current.scrollTop = d.top - dy;
  }
  function onPointerUp() {
    // a click (no drag) on the photo switches between fit and 2x
    if (drag.current && !drag.current.moved) setZoomStep(0);
    else if (!drag.current && zoom === 1) {
      rememberFit(); // PV2
      setZoomStep(2);
    }
    drag.current = null;
  }

  const btn = "inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-white hover:bg-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-40 disabled:hover:bg-transparent";

  return (
    <dialog
      ref={ref}
      aria-label={photo ? `Photo ${index! + 1} of ${photos.length}: ${photo.alt}` : "Photo"}
      // a click on the dark area outside the photo closes it
      onClick={(e) => {
        if (e.target === e.currentTarget) onIndex(null);
      }}
      // Esc or close(): tell the page it is closed. stopPropagation = a popup around this one (New appraisal) stays open
      onCancel={(e) => e.stopPropagation()}
      onClose={(e) => {
        e.stopPropagation();
        onIndex(null);
      }}
      onKeyDown={onKeyDown}
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 backdrop:bg-navy-950/75 backdrop:backdrop-blur-sm"
    >
      {photo && (
        <div className="flex h-full flex-col" onClick={(e) => e.target === e.currentTarget && onIndex(null)}>
          {/* top bar: which photo, zoom buttons, close */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-navy-950/60 px-3 py-2 text-sm text-white">
            <p className="min-w-0 truncate">
              <span className="font-medium">
                Photo {index! + 1} of {photos.length}
              </span>
              <span className="ml-2 text-white/75">{photo.alt}</span>
            </p>
            <div className="flex items-center gap-1">
              <button type="button" className={btn} onClick={() => zoomBy(-1)} disabled={zoomStep === 0} aria-label="Zoom out">
                <Icon name="minus" className="h-5 w-5" />
              </button>
              {/* the zoom level; clicking it goes back to "fit" */}
              <button type="button" className={`${btn} w-16 tabular-nums`} onClick={() => setZoomStep(0)} aria-label={`Zoom ${Math.round(zoom * 100)}%. Fit to screen`}>
                {zoom === 1 ? "Fit" : `${Math.round(zoom * 100)}%`}
              </button>
              <button type="button" className={btn} onClick={() => zoomBy(1)} disabled={zoomStep === ZOOMS.length - 1} aria-label="Zoom in">
                <Icon name="plus" className="h-5 w-5" />
              </button>
              <button type="button" className={`${btn} ml-2`} onClick={() => onIndex(null)} aria-label="Close photo" ref={closeBtn}>
                <Icon name="x" className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* the photo. At "fit" it is as big as the screen allows; zoomed, the area scrolls and can be dragged */}
          <div
            ref={box}
            className={`relative min-h-0 flex-1 overflow-auto ${zoom === 1 ? "flex items-center justify-center" : ""}`}
            onClick={(e) => e.target === e.currentTarget && zoom === 1 && onIndex(null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored or local photo, not a page image */}
            <img
              src={photo.url}
              alt={photo.alt}
              draggable={false}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              // PV2: zoomed = the Fit width times the zoom (e.g. 200% = twice as wide as at Fit)
              style={zoom === 1 ? undefined : { width: `${Math.round((fitWidth || 600) * zoom)}px`, maxWidth: "none" }}
              className={
                zoom === 1
                  ? "max-h-full max-w-full cursor-zoom-in select-none object-contain p-4"
                  : "mx-auto block h-auto cursor-grab touch-none select-none active:cursor-grabbing"
              }
            />
          </div>

          {/* previous / next, only when there is more than one photo */}
          {photos.length > 1 && (
            <div className="flex items-center justify-center gap-3 bg-navy-950/60 px-3 py-2 text-sm text-white">
              <button type="button" className={btn} onClick={() => go(-1)} aria-label="Previous photo">
                <Icon name="chevron-left" className="h-5 w-5" />
              </button>
              <span className="tabular-nums">
                {index! + 1} / {photos.length}
              </span>
              <button type="button" className={btn} onClick={() => go(1)} aria-label="Next photo">
                <Icon name="chevron-right" className="h-5 w-5" />
              </button>
            </div>
          )}
          <p className="sr-only">Arrow keys: previous or next photo. Plus and minus: zoom. Escape: close.</p>
        </div>
      )}
    </dialog>
  );
}

/** PV1: a grid of thumbnails that open the popup (used on the appraisal page). */
export function PhotoGrid({ photos, className }: { photos: ViewerPhoto[]; className?: string }) {
  const [open, setOpen] = useState<number | null>(null); // which photo is open
  return (
    <>
      <div className={className}>
        {photos.map((p, i) => (
          <button
            key={p.url}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={`View photo ${i + 1} of ${photos.length}: ${p.alt}`} // PV2
            className="block cursor-zoom-in overflow-hidden rounded-md border border-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a stored photo, not a page image */}
            <img src={p.url} alt="" className="aspect-square w-full object-cover" />
          </button>
        ))}
      </div>
      <PhotoViewer photos={photos} index={open} onIndex={setOpen} />
    </>
  );
}
