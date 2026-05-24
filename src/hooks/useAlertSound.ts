import { useEffect, useRef } from "react";

// Two-tone beep using WebAudio — no asset needed.
export function useAlertSound(triggerKey: string, enabled = true) {
  const ctxRef = useRef<AudioContext | null>(null);
  const prevKey = useRef<string>("");
  const armed = useRef(false);

  // First render must NOT play sound; only on subsequent key changes.
  useEffect(() => {
    if (!enabled) return;
    if (!armed.current) {
      armed.current = true;
      prevKey.current = triggerKey;
      return;
    }
    if (triggerKey === prevKey.current || !triggerKey) return;
    prevKey.current = triggerKey;
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = ctxRef.current ?? (ctxRef.current = new AC());
      if (ctx.state === "suspended") ctx.resume();
      const now = ctx.currentTime;
      const play = (freq: number, start: number, dur = 0.18) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.25, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
      };
      play(880, 0);
      play(1320, 0.18);
    } catch {}
  }, [triggerKey, enabled]);
}
