import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { IScannerControls } from "@zxing/browser";
import { IconClose, IconTorch } from "./icons";

/** The barcode library is big, so it loads on first use (and is warmed up in the background after launch). */
export const loadZxing = () => Promise.all([import("@zxing/browser"), import("@zxing/library")]);

type Props = {
  onCode: (code: string) => void;
  onClose: () => void;
  /** Haul mode: keep scanning after each code. */
  continuous?: boolean;
  /** Shown above the manual-entry box (e.g. the haul tally). */
  status?: ComponentChildren;
  hint?: string;
};

/** Full-screen camera. Single mode returns the first barcode; continuous mode keeps going. */
export function Scanner({ onCode, onClose, continuous = false, status, hint }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState<null | boolean>(null); // null = not supported
  const track = useRef<MediaStreamTrack | null>(null);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let done = false;
    const seen = new Map<string, number>(); // code → last time accepted
    let lastAccepted = 0;

    const accept = (code: string) => {
      const now = Date.now();
      if (continuous) {
        if (now - lastAccepted < 1200) return; // give you time to move to the next case
        if (now - (seen.get(code) ?? 0) < 4000) return; // same case still in view
        seen.set(code, now);
        lastAccepted = now;
        setFlash(true);
        setTimeout(() => setFlash(false), 250);
        cb.current(code);
      } else if (!done) {
        done = true;
        controls?.stop();
        cb.current(code);
      }
    };

    loadZxing()
      .then(([{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }]) => {
        if (done) return Promise.reject(Object.assign(new Error("closed"), { name: "Closed" }));
        const hints = new Map<unknown, unknown>([
          [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]],
          [DecodeHintType.TRY_HARDER, true],
        ]);
        const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 100 });
        return reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        video.current!,
        (result) => {
          if (result) accept(result.getText());
        },
      );
      })
      .then((c) => {
        controls = c;
        if (done) return c.stop();
        // Flashlight for dim aisles, where the phone allows it.
        const t = (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0] ?? null;
        track.current = t;
        const caps = (t?.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);
      })
      .catch((e: Error) => {
        if (e.name === "Closed") return;
        setError(
          e.name === "NotAllowedError"
            ? "Camera access is off. Allow it for Keeper in iPhone Settings, or type the barcode below."
            : "Couldn't start the camera. You can type the barcode below.",
        );
      });
    return () => {
      done = true;
      controls?.stop();
    };
  }, [continuous]);

  return (
    <div class={`scanner ${flash ? "flash" : ""}`} role="dialog" aria-label="Scan a barcode">
      <video ref={video} playsInline muted autoPlay />
      <div class="scanner-frame" aria-hidden="true"><span class="scan-line" /></div>
      {torch !== null && (
        <button
          class={`scanner-torch icon-btn ${torch ? "on" : ""}`}
          aria-label={torch ? "Turn flashlight off" : "Turn flashlight on"}
          aria-pressed={torch}
          onClick={async () => {
            try {
              await track.current?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] });
              setTorch(!torch);
            } catch {
              setTorch(null);
            }
          }}
        >
          <IconTorch />
        </button>
      )}
      {continuous ? (
        <button class="scanner-done btn primary" onClick={onClose}>Done</button>
      ) : (
        <button class="scanner-close icon-btn" aria-label="Close scanner" onClick={onClose}>
          <IconClose />
        </button>
      )}
      <div class="scanner-foot">
        {status}
        <p>{error ?? hint ?? "Point at the barcode on the back of the case"}</p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            const code = manual.replace(/\D/g, "");
            if (code.length >= 8) {
              setManual("");
              cb.current(code);
            }
          }}
        >
          <input
            inputMode="numeric"
            placeholder="…or type the numbers"
            aria-label="Barcode number"
            value={manual}
            onInput={(e) => setManual((e.target as HTMLInputElement).value)}
          />
          <button class="btn" type="submit">Go</button>
        </form>
      </div>
    </div>
  );
}
