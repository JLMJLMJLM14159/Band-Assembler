// Live playback with a look-ahead scheduler, and rendering a performance to a WAV file.

import { LiveSettings, perform, PerformedBar, performanceLength } from "./performance";
import { applyMix, Bus, closeBus, createBus, Mix, playEvent } from "./synth";

export interface Position {
  chartIndex: number;
  chorus: number;
}

const LOOKAHEAD = 0.35;

export class Player {
  private ctx: AudioContext | null = null;
  private bus: Bus | null = null;
  private bars: Generator<PerformedBar> | null = null;
  private timer = 0;
  private frame = 0;
  private nextTime = 0;
  private endTime = Infinity;
  private queue: Array<{ time: number; pos: Position }> = [];

  onPosition: (pos: Position | null) => void = () => {};

  constructor(public live: LiveSettings, public mix: Mix) {}

  get playing(): boolean {
    return this.bars !== null;
  }

  async start(): Promise<void> {
    this.stop();
    this.ctx ??= new AudioContext({ latencyHint: "interactive" });
    await this.ctx.resume();
    this.bus = createBus(this.ctx, this.mix);
    this.bars = perform(this.live);
    this.nextTime = this.ctx.currentTime + 0.08;
    this.endTime = Infinity;
    this.queue = [];
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
    this.frame = requestAnimationFrame(() => this.track());
  }

  stop(): void {
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    if (this.bus) closeBus(this.bus);
    this.bus = null;
    this.bars = null;
    this.queue = [];
    this.onPosition(null);
  }

  setMix(mix: Mix): void {
    this.mix = mix;
    if (this.bus) applyMix(this.bus, mix);
  }

  private schedule(): void {
    if (!this.ctx || !this.bus || !this.bars) return;
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      const next = this.bars.next();
      if (next.done) {
        if (this.endTime === Infinity) this.endTime = this.nextTime;
        return;
      }
      const bar = next.value;
      scheduleBar(this.bus, bar, this.nextTime);
      this.queue.push({ time: this.nextTime, pos: { chartIndex: bar.chartIndex, chorus: bar.chorus } });
      this.nextTime += bar.beats * bar.beatSec;
    }
  }

  private track(): void {
    if (!this.ctx || !this.bars) return;
    const now = this.ctx.currentTime;
    let current: Position | undefined;
    while (this.queue.length && this.queue[0].time <= now) current = this.queue.shift()!.pos;
    if (current) this.onPosition(current);
    if (now > this.endTime + 0.5) {
      this.stop();
      return;
    }
    this.frame = requestAnimationFrame(() => this.track());
  }
}

function scheduleBar(bus: Bus, bar: PerformedBar, start: number): void {
  for (const ev of bar.events) playEvent(bus, ev, start + ev.time * bar.beatSec, bar.beatSec);
}

/** Renders a fixed number of choruses offline and returns a 16-bit stereo WAV. */
export async function renderWav(live: LiveSettings, mix: Mix, sampleRate = 44100): Promise<Blob> {
  const settings = { ...live, countIn: false, choruses: Math.max(1, live.choruses) };
  const seconds = performanceLength(settings) + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const bus = createBus(ctx, mix);
  let t = 0.05;
  for (const bar of perform(settings)) {
    scheduleBar(bus, bar, t);
    t += bar.beats * bar.beatSec;
  }
  const audio = await ctx.startRendering();
  return encodeWav(audio);
}

export function encodeWav(audio: AudioBuffer): Blob {
  const channels = audio.numberOfChannels;
  const frames = audio.length;
  const bytes = frames * channels * 2;
  const view = new DataView(new ArrayBuffer(44 + bytes));
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, audio.sampleRate, true);
  view.setUint32(28, audio.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, bytes, true);
  const data = Array.from({ length: channels }, (_, c) => audio.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([view.buffer], { type: "audio/wav" });
}
