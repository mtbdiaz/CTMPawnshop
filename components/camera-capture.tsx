"use client"; // runs in the browser: it uses the device's camera

import { useEffect, useRef, useState } from "react";
import { buttonClasses, cx } from "./ui";
import { Icon } from "./icons";

// CAM1 (Matt, Nov 11): take an item photo with the camera, not only upload a file.
// Opens a popup with the live camera (the back camera on a phone), Take photo, then Use photo or Retake.
// The photo is handed back as a JPEG file, so it goes through the same checks and upload as "Add photos".
// If the browser can't use the camera here (no camera, permission refused, an old browser), the popup says so and
// offers the phone's own camera app instead (a file box with capture), and "Add photos" still works.
// Nov 16 (Wush): a laptop can list a second "camera" that can't show a picture (an infrared or virtual one).
//   - Switching to a camera that won't start now goes back to the camera that was working, says so, and takes the
//     broken one off the Switch list. Before, it ended on an error with no way back.
//   - The error screen has "Try again", and on a computer the file button says "Choose a photo file" (it opens the
//     file window there; only a phone opens its camera app).
type Phase = "starting" | "live" | "taken" | "error";

export function CameraButton({ onCapture, disabled, compact }: { onCapture: (file: File) => void; disabled?: boolean; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null); // the popup
  const video = useRef<HTMLVideoElement>(null); // the live picture
  const stream = useRef<MediaStream | null>(null); // the camera, so it can be switched off
  const shot = useRef<Blob | null>(null); // the photo just taken
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null); // the photo just taken, to look at before using it
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]); // every camera, for "Switch camera"
  const [cameraIndex, setCameraIndex] = useState<number | null>(null); // null = the back camera if there is one
  const [note, setNote] = useState(""); // a small message under the picture, e.g. after a failed switch
  const working = useRef<string | null>(null); // the camera that last showed a picture (to go back to)
  const broken = useRef(new Set<string>()); // cameras that wouldn't start: left out of "Switch camera"
  const [brokenIds, setBrokenIds] = useState<string[]>([]); // the same list, for the screen (hides Switch camera when only one works)
  const [touch, setTouch] = useState(false); // a phone or tablet: its file button opens the camera app

  // switch the camera off (the light on a laptop goes off too)
  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  async function startCamera(index: number | null, backTo?: string | null) {
    stopCamera();
    setPhase("starting");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't open the camera here.");
      setPhase("error");
      return;
    }
    try {
      const device = index !== null ? usable()[index] : undefined;
      stream.current = await navigator.mediaDevices.getUserMedia({
        video: device
          ? { deviceId: { exact: device.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, // the back camera on a phone
        audio: false,
      });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play().catch(() => undefined);
      }
      // the camera names are only shown after permission, so list them now
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      setCameras(all);
      working.current = stream.current.getVideoTracks()[0]?.getSettings().deviceId ?? null;
      setPhase("live");
    } catch (e) {
      const name = (e as { name?: string })?.name;
      // a switch that failed: remember that camera as broken and go back to the one that was working
      const tried = index !== null ? usable()[index] : undefined;
      if (tried && backTo && tried.deviceId !== backTo) {
        broken.current.add(tried.deviceId);
        setBrokenIds([...broken.current]);
        const back = usable().findIndex((c) => c.deviceId === backTo);
        if (back >= 0) {
          setCameraIndex(back);
          setNote(`${tried.label ? `"${tried.label}"` : "That camera"} couldn't be started, so the first camera is back on.`);
          await startCamera(back);
          return;
        }
      }
      setError(
        name === "NotAllowedError"
          ? "Camera permission was refused. Allow the camera for this site in the browser settings, or use the camera app below."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "No camera was found on this device."
            : "The camera could not be started. It may be in use by another app.",
      );
      setPhase("error");
    }
  }

  // open: show the popup and start the camera. Closing (Esc, X, Cancel) always switches the camera off
  useEffect(() => {
    if (!open) return;
    dialog.current?.showModal();
    void startCamera(cameraIndex); // starts the camera once the popup (and its video) is on screen
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the popup opens; switching is done by the button
  }, [open]);

  // free the preview's memory when it is replaced or the popup closes
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function takePhoto() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement("canvas"); // draw the current picture into an image
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")?.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        shot.current = blob;
        setPreview(URL.createObjectURL(blob));
        setPhase("taken");
      },
      "image/jpeg",
      0.85, // good quality, usually well under the 5 MB limit
    );
  }

  function usePhoto() {
    if (!shot.current) return;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    onCapture(new File([shot.current], `camera-${stamp}.jpg`, { type: "image/jpeg" })); // same path as an uploaded file
    dialog.current?.close();
  }

  // the cameras "Switch camera" goes through: every camera except the ones that wouldn't start
  function usable() {
    return cameras.filter((c) => !broken.current.has(c.deviceId));
  }

  function switchCamera() {
    const list = usable();
    if (list.length < 2) return;
    const current = stream.current?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
    const at = list.findIndex((c) => c.deviceId === current);
    const next = (at + 1) % list.length;
    setNote("");
    setCameraIndex(next);
    void startCamera(next, current);
  }

  // the phone's own camera app (fallback): a file box that asks for the camera
  function fromCameraApp(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) {
      onCapture(f);
      dialog.current?.close();
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setPreview(null);
          shot.current = null;
          setError("");
          setNote("");
          setCameraIndex(null); // start on the usual camera every time the popup opens
          setTouch(window.matchMedia("(pointer: coarse)").matches);
          setOpen(true);
        }}
        className={cx(
          "flex items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:border-navy-500 hover:bg-slate-50 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy-500 disabled:pointer-events-none disabled:opacity-60",
          compact ? "py-2" : "py-4",
        )}
      >
        <Icon name="camera" className="h-4 w-4 text-slate-500" />
        Take photo
      </button>
      {open && (
        <dialog
          ref={dialog}
          aria-labelledby="camera-title"
          // stopPropagation: a popup around this one (New appraisal) must stay open
          onCancel={(e) => e.stopPropagation()}
          onClose={(e) => {
            e.stopPropagation();
            stopCamera();
            setOpen(false);
          }}
          className="m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-slate-200 p-0 shadow-2xl backdrop:bg-navy-950/60"
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3">
            <h2 id="camera-title" className="text-lg font-semibold text-slate-900">
              Take a photo of the item
            </h2>
            <button type="button" onClick={() => dialog.current?.close()} aria-label="Close camera" className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
              <Icon name="x" className="h-5 w-5" />
            </button>
          </div>

          <div className="bg-navy-950">
            {/* the live camera; hidden (not removed) after a shot so it can come back for Retake */}
            <video ref={video} playsInline muted className={cx("mx-auto max-h-[60dvh] w-full object-contain", phase !== "live" && phase !== "starting" && "hidden")} aria-label="Live camera" />
            {phase === "taken" && preview && (
              // eslint-disable-next-line @next/next/no-img-element -- a local preview, not a page image
              <img src={preview} alt="The photo just taken" className="mx-auto max-h-[60dvh] w-full object-contain" />
            )}
            {phase === "starting" && <p className="px-5 py-3 text-center text-sm text-white/80">Starting the camera. Allow the camera if the browser asks.</p>}
          </div>
          {note && phase !== "error" && (
            <p role="status" className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-sm text-amber-900">
              {note}
            </p>
          )}

          {phase === "error" && (
            <div role="alert" className="space-y-3 px-5 py-4 text-sm">
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">{error}</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => { setNote(""); setCameraIndex(null); void startCamera(null); }} className={buttonClasses("secondary")}>
                  Try again
                </button>
                {/* on a phone this opens the camera app straight away; on a computer it opens the file window, so it says so */}
                <label className={cx(buttonClasses("secondary"), "cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-navy-500")}>
                  <Icon name="camera" className="h-4 w-4" />
                  {touch ? "Use the camera app" : "Choose a photo file"}
                  <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={fromCameraApp} className="sr-only" />
                </label>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-5 py-3">
            <div>
              {phase === "live" && cameras.filter((c) => !brokenIds.includes(c.deviceId)).length > 1 && (
                <button type="button" onClick={switchCamera} className={buttonClasses("secondary", "sm")}>
                  Switch camera
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => dialog.current?.close()} className={buttonClasses("secondary")}>
                Cancel
              </button>
              {phase === "live" && (
                <button type="button" onClick={takePhoto} className={buttonClasses("primary")} autoFocus>
                  <Icon name="camera" className="h-4 w-4" />
                  Take photo
                </button>
              )}
              {phase === "taken" && (
                <>
                  <button type="button" onClick={() => { setPreview(null); shot.current = null; setPhase("live"); }} className={buttonClasses("secondary")}>
                    Retake
                  </button>
                  <button type="button" onClick={usePhoto} className={buttonClasses("primary")} autoFocus>
                    Use photo
                  </button>
                </>
              )}
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
