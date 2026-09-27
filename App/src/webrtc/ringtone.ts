// Group-call ringback. Plays the bundled ringtone clip, looping with a short
// gap so it reads as "ring, ring" rather than a stuck sample.

export type RingPattern = 'incoming' | 'outgoing';

const RING_SRC = `${import.meta.env.BASE_URL}audio/discord_remix.mp3`;

interface RingConfig {
  /** Silence between repeats of the clip. */
  gapMs: number;
  /**
   * Slight tempo shift so you can tell an incoming ring from an outgoing one
   * by ear. Pitch is preserved, so voices/music don't sound chipmunked.
   */
  rate: number;
}

const PATTERNS: Record<RingPattern, RingConfig> = {
  incoming: { gapMs: 1100, rate: 1 },
  outgoing: { gapMs: 700, rate: 1.12 },
};

const VOLUME = 0.9;
const VIBRATE_MS: number[] | false = [400, 250, 400];

class RingtoneEngine {
  private players = new Map<RingPattern, HTMLAudioElement>();
  private pattern: RingPattern | null = null;
  private gapTimer: number | null = null;
  private vibTimer: number | null = null;

  private getPlayer(pattern: RingPattern): HTMLAudioElement {
    let el = this.players.get(pattern);
    if (el) return el;

    el = new Audio(RING_SRC);
    el.preload = 'auto';
    el.volume = VOLUME;
    el.loop = false;
    // Keep pitch steady while we shift tempo to tell the two rings apart
    el.preservesPitch = true;
    el.playbackRate = PATTERNS[pattern].rate;

    // Re-arm the clip with a gap instead of the browser's seamless loop
    el.addEventListener('ended', () => {
      if (this.pattern === pattern && !el!.paused) {
        this.gapTimer = window.setTimeout(() => {
          this.gapTimer = null;
          if (this.pattern === pattern) void this.play(el!);
        }, PATTERNS[pattern].gapMs);
      }
    });

    el.addEventListener('error', () => {
      console.warn(`[Ringtone] Failed to load ${RING_SRC}, falling back to synth chime`);
      this.playSynthBeep(pattern);
    });

    this.players.set(pattern, el);
    return el;
  }

  private playSynthBeep(pattern: RingPattern) {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      const now = ctx.currentTime;
      if (pattern === 'incoming') {
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.setValueAtTime(880, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
        osc.start(now);
        osc.stop(now + 0.4);
      } else {
        osc.frequency.setValueAtTime(480, now);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.start(now);
        osc.stop(now + 0.3);
      }
    } catch {
      // AudioContext unavailable
    }
  }

  private async play(el: HTMLAudioElement) {
    el.currentTime = 0;
    try {
      await el.play();
    } catch (err) {
      // Autoplay policy: the callee has often not interacted with the page yet,
      // so retry on the first gesture rather than staying silent.
      const unlock = () => {
        el.play().catch(() => {
          /* still blocked, give up */
        });
      };
      window.addEventListener('pointerdown', unlock, { once: true });
      window.addEventListener('keydown', unlock, { once: true });
      console.debug('[Ringtone] Blocked by autoplay policy, waiting for a gesture', err);
    }
  }

  start(pattern: RingPattern) {
    this.stop();

    this.pattern = pattern;
    const el = this.getPlayer(pattern);
    void this.play(el);

    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function' && VIBRATE_MS) {
      navigator.vibrate(VIBRATE_MS);
      this.vibTimer = window.setInterval(() => navigator.vibrate(VIBRATE_MS), 3000);
    }
  }

  stop() {
    if (this.gapTimer !== null) {
      window.clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
    if (this.vibTimer !== null) {
      window.clearInterval(this.vibTimer);
      this.vibTimer = null;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(0);
    }

    this.pattern = null;
    this.players.forEach((el) => {
      el.pause();
      el.currentTime = 0;
    });
  }
}

let engine: RingtoneEngine | null = null;

export function startRingtone(pattern: RingPattern) {
  if (!engine) engine = new RingtoneEngine();
  engine.start(pattern);
}

export function stopRingtone() {
  engine?.stop();
}
