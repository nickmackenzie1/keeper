/**
 * Little moments of joy: confetti, a chime, and a buzz where the phone allows it.
 * (iPhones don't expose vibration to web apps, so there the chime does the job.)
 */

let audio: AudioContext | null = null;

/** Call from a tap (e.g. opening the scanner) so iOS lets us play sound later. */
export function primeAudio() {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audio ??= new AC();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    /* no audio */
  }
}

function tone(freq: number, start: number, dur: number, gain = 0.18) {
  if (!audio) return;
  const t0 = audio.currentTime + start;
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = "triangle";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function chime(kind: "jackpot" | "blip" = "blip") {
  if (kind === "jackpot") {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.35));
    navigator.vibrate?.([60, 40, 60, 40, 120]);
  } else {
    tone(880, 0, 0.12, 0.12);
    navigator.vibrate?.(30);
  }
}

export function confetti(durationMs = 2200) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const style = getComputedStyle(document.documentElement);
  const colours = ["--accent", "--good-bg", "--upgrade-bg", "--have-bg", "--chip-bd-bg"].map((v) => style.getPropertyValue(v).trim() || "#f5b841");
  const pieces = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 14 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    c: colours[Math.floor(Math.random() * colours.length)],
  }));

  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = t > durationMs - 500 ? Math.max(0, (durationMs - t) / 500) : 1;
    for (const p of pieces) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t < durationMs) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}

export function celebrate() {
  confetti();
  chime("jackpot");
}

// ---- toasts ----
export function toast(text: string, ms = 3200) {
  let host = document.querySelector<HTMLDivElement>(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    document.body.appendChild(host);
  }
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = text;
  host.appendChild(el);
  setTimeout(() => el.classList.add("out"), ms);
  setTimeout(() => el.remove(), ms + 400);
}
