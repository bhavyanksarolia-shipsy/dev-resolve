/**
 * The notification sound: a short chime made in the browser (no file). Browsers allow sound only after the person has
 * clicked or typed on the page once, so the first click "unlocks" it. Off when the bell menu's Sound switch is off.
 */
export const SOUND_KEY = "dr.notify.sound";
let audio: AudioContext | null = null;

export function soundOn() {
  try { return localStorage.getItem(SOUND_KEY) !== "off"; } catch { return true; }
}
export function setSoundOn(on: boolean) {
  try { localStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* private window */ }
}

export function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch { /* no audio */ }
}
if (typeof window !== "undefined") {
  for (const e of ["pointerdown", "keydown"]) window.addEventListener(e, unlockAudio, { capture: true, passive: true });
}

/** ok: two rising notes · error: two falling · warn: one double beep · info: one soft note. */
export function chime(tone: "ok" | "error" | "warn" | "info" = "ok", force = false) {
  if ((!force && !soundOn()) || !audio || audio.state !== "running") return;
  const notes = tone === "ok" ? [660, 880] : tone === "error" ? [440, 330] : tone === "warn" ? [587, 587] : [740];
  notes.forEach((f, i) => {
    const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * 0.16;
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(audio!.destination); o.start(t); o.stop(t + 0.4);
  });
}
