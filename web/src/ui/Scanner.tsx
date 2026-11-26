import { useEffect, useRef, useState } from "preact/hooks";
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { BarcodeFormat, DecodeHintType } from "@zxing/library";
import { IconClose } from "./icons";

const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.EAN_8]],
  [DecodeHintType.TRY_HARDER, true],
]);

/** Full-screen camera that returns the first barcode it reads. */
export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    let controls: IScannerControls | undefined;
    let done = false;
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 120 });
    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        video.current!,
        (result) => {
          if (result && !done) {
            done = true;
            navigator.vibrate?.(40);
            controls?.stop();
            onCode(result.getText());
          }
        },
      )
      .then((c) => {
        controls = c;
        if (done) c.stop();
      })
      .catch((e: Error) => {
        setError(
          e.name === "NotAllowedError"
            ? "Camera access is off. Allow it in Settings › Safari › Camera (or for the Keeper home-screen app), or type the barcode below."
            : "Couldn't start the camera. You can type the barcode below.",
        );
      });
    return () => {
      done = true;
      controls?.stop();
    };
  }, []);

  return (
    <div class="scanner" role="dialog" aria-label="Scan a barcode">
      <video ref={video} playsInline muted autoPlay />
      <div class="scanner-frame" aria-hidden="true" />
      <button class="scanner-close icon-btn" aria-label="Close scanner" onClick={onClose}>
        <IconClose />
      </button>
      <div class="scanner-foot">
        <p>{error ?? "Point at the barcode on the back of the case"}</p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            const code = manual.replace(/\D/g, "");
            if (code.length >= 8) onCode(code);
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
