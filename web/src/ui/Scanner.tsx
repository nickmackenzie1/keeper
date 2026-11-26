import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { IconClose } from "./icons";

const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]],
  [DecodeHintType.TRY_HARDER, true],
]);

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
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let done = false;
    const seen = new Map<string, number>(); // code → last time accepted
    let lastAccepted = 0;
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });

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

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        video.current!,
        (result) => {
          if (result) accept(result.getText());
        },
      )
      .then((c) => {
        controls = c;
        if (done) c.stop();
      })
      .catch((e: Error) => {
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
      <div class="scanner-frame" aria-hidden="true" />
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
