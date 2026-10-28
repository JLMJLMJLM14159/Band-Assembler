// Synthesised band: an FM electric piano, a plucked bass and a small drum kit, all built from Web Audio nodes.
// Every voice takes a BaseAudioContext so the same code plays live and renders to a file.

import { Instrument, NoteEvent } from "./arranger";

export type Group = "piano" | "bass" | "drums";
export const GROUPS: Group[] = ["piano", "bass", "drums"];

export interface Mix {
  piano: number;
  bass: number;
  drums: number;
  muted: Record<Group, boolean>;
}

export function defaultMix(): Mix {
  return { piano: 0.8, bass: 0.9, drums: 0.8, muted: { piano: false, bass: false, drums: false } };
}

export function groupOf(inst: Instrument): Group {
  return inst === "piano" ? "piano" : inst === "bass" ? "bass" : "drums";
}

export interface Bus {
  ctx: BaseAudioContext;
  /** Everything for one play-through goes through here, so stopping is one fade. */
  session: GainNode;
  groups: Record<Group, GainNode>;
}

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
const outputCache = new WeakMap<BaseAudioContext, AudioNode>();

function noise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** Master chain shared by every session on a context: a little room reverb and a gentle compressor. */
function masterInput(ctx: BaseAudioContext): AudioNode {
  let input = outputCache.get(ctx);
  if (input) return input;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  const master = ctx.createGain();
  master.gain.value = 1.1;
  // A soft clipper after the compressor catches the odd transient instead of hard clipping.
  const clip = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(((i / (curve.length - 1)) * 2 - 1) * 1.2) / Math.tanh(1.2);
  clip.curve = curve;
  master.connect(comp).connect(clip).connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = roomImpulse(ctx, 1.6);
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverb.connect(wet).connect(master);

  const dry = ctx.createGain();
  dry.connect(master);
  dry.connect(reverb);
  outputCache.set(ctx, dry);
  return dry;
}

function roomImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }
  return buf;
}

export function createBus(ctx: BaseAudioContext, mix: Mix): Bus {
  const session = ctx.createGain();
  session.connect(masterInput(ctx));
  const groups = {} as Record<Group, GainNode>;
  for (const g of GROUPS) {
    groups[g] = ctx.createGain();
    groups[g].connect(session);
  }
  applyMix({ ctx, session, groups }, mix);
  return { ctx, session, groups };
}

export function applyMix(bus: Bus, mix: Mix): void {
  for (const g of GROUPS) {
    const level = mix.muted[g] ? 0 : mix[g];
    bus.groups[g].gain.setTargetAtTime(level, bus.ctx.currentTime, 0.02);
  }
}

/** Fades a session out and disconnects it, silencing anything still scheduled on it. */
export function closeBus(bus: Bus): void {
  const now = bus.ctx.currentTime;
  bus.session.gain.cancelScheduledValues(now);
  bus.session.gain.setValueAtTime(bus.session.gain.value, now);
  bus.session.gain.linearRampToValueAtTime(0, now + 0.08);
  setTimeout(() => bus.session.disconnect(), 200);
}

function mtof(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

/** Schedules one event. `time` is in context seconds and `beat` is the length of a beat in seconds. */
export function playEvent(bus: Bus, ev: NoteEvent, time: number, beat: number): void {
  const out = bus.groups[groupOf(ev.inst)];
  const dur = ev.dur * beat;
  const ctx = bus.ctx;
  switch (ev.inst) {
    case "piano":
      ev.notes?.forEach((n, i) => epiano(ctx, out, time + i * 0.004, dur, n, ev.vel * 0.55));
      break;
    case "bass":
      ev.notes?.forEach((n) => bass(ctx, out, time, dur, n, ev.vel));
      break;
    case "kick":
      kick(ctx, out, time, ev.vel);
      break;
    case "snare":
      snare(ctx, out, time, ev.vel);
      break;
    case "rim":
      rim(ctx, out, time, ev.vel);
      break;
    case "hat":
      metal(ctx, out, time, ev.vel * 0.35, 0.05, 7000);
      break;
    case "hatOpen":
      metal(ctx, out, time, ev.vel * 0.35, 0.35, 7000);
      break;
    case "pedal":
      metal(ctx, out, time, ev.vel * 0.25, 0.04, 5000);
      break;
    case "ride":
      ride(ctx, out, time, ev.vel);
      break;
    case "crash":
      metal(ctx, out, time, ev.vel * 0.5, 1.8, 4000);
      noiseHit(ctx, out, time, ev.vel * 0.25, 1.5, "highpass", 5000, 0.5);
      break;
    case "brush":
      brush(ctx, out, time, dur, ev.vel);
      break;
    case "brushTap":
      noiseHit(ctx, out, time, ev.vel * 0.5, 0.14, "bandpass", 2600, 0.8);
      break;
    case "tom":
      tom(ctx, out, time, ev.vel, ev.notes?.[0] ?? 45);
      break;
    case "shaker":
      noiseHit(ctx, out, time, ev.vel * 0.3, 0.06, "highpass", 6000, 0.7);
      break;
    case "click":
      click(ctx, out, time, ev.vel);
      break;
  }
}

function envGain(ctx: BaseAudioContext, out: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.value = 0;
  g.connect(out);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, dest: AudioNode, start: number, stop: number): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.connect(dest);
  o.start(start);
  o.stop(stop);
  return o;
}

/** Two-operator FM, the classic recipe for a Rhodes-like tine piano. */
function epiano(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, note: number, vel: number): void {
  const f = mtof(note);
  const end = t + dur + 0.25;
  const amp = envGain(ctx, out);
  const peak = vel * 0.32;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.006);
  amp.gain.setTargetAtTime(peak * 0.45, t + 0.006, 0.35);
  amp.gain.setTargetAtTime(0, t + dur, 0.08);

  const carrier = osc(ctx, "sine", f, amp, t, end);
  const modGain = ctx.createGain();
  modGain.gain.setValueAtTime(f * (1.2 + vel * 2.2), t);
  modGain.gain.setTargetAtTime(f * 0.25, t, 0.25);
  modGain.connect(carrier.frequency);
  osc(ctx, "sine", f, modGain, t, end);

  // A short bright "tine" at the start of each note.
  const tine = envGain(ctx, out);
  tine.gain.setValueAtTime(peak * 0.18, t);
  tine.gain.setTargetAtTime(0, t, 0.05);
  osc(ctx, "sine", f * 7, tine, t, t + 0.3);
}

function bass(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, note: number, vel: number): void {
  const f = mtof(note);
  const end = t + dur + 0.15;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.Q.value = 1.5;
  filter.frequency.setValueAtTime(400 + vel * 1400, t);
  filter.frequency.setTargetAtTime(250, t, 0.12);
  const amp = envGain(ctx, out);
  filter.connect(amp);
  const peak = vel * 0.1;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + 0.008);
  amp.gain.setTargetAtTime(peak * 0.35, t + 0.01, 0.3);
  amp.gain.setTargetAtTime(0, t + dur, 0.05);
  osc(ctx, "triangle", f, filter, t, end);
  osc(ctx, "sawtooth", f, filter, t, end).detune.value = 4;
  osc(ctx, "sine", f, amp, t, end);
}

function kick(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number): void {
  const amp = envGain(ctx, out);
  amp.gain.setValueAtTime(vel * 0.65, t);
  amp.gain.setTargetAtTime(0, t + 0.02, 0.09);
  const o = osc(ctx, "sine", 120, amp, t, t + 0.5);
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
}

function snare(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number): void {
  noiseHit(ctx, out, t, vel * 0.5, 0.16, "highpass", 1400, 0.7);
  const amp = envGain(ctx, out);
  amp.gain.setValueAtTime(vel * 0.35, t);
  amp.gain.setTargetAtTime(0, t, 0.04);
  const o = osc(ctx, "triangle", 190, amp, t, t + 0.2);
  o.frequency.exponentialRampToValueAtTime(150, t + 0.1);
}

function rim(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number): void {
  noiseHit(ctx, out, t, vel * 0.5, 0.025, "bandpass", 1900, 6);
  const amp = envGain(ctx, out);
  amp.gain.setValueAtTime(vel * 0.3, t);
  amp.gain.setTargetAtTime(0, t, 0.012);
  osc(ctx, "triangle", 820, amp, t, t + 0.08);
}

function tom(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number, note: number): void {
  const f = mtof(note);
  const amp = envGain(ctx, out);
  amp.gain.setValueAtTime(vel * 0.6, t);
  amp.gain.setTargetAtTime(0, t + 0.02, 0.12);
  const o = osc(ctx, "sine", f * 1.5, amp, t, t + 0.6);
  o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
}

/** Six detuned square waves through a high-pass filter: the 808 way to make cymbals. */
function metal(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number, decay: number, cutoff: number): void {
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = cutoff;
  const amp = envGain(ctx, out);
  hp.connect(amp);
  // Six square waves add up; keep the sum near unity.
  amp.gain.setValueAtTime(vel / 3, t);
  amp.gain.setTargetAtTime(0, t + 0.002, decay / 3);
  const end = t + decay * 2 + 0.05;
  for (const ratio of [2, 3, 4.16, 5.43, 6.79, 8.21]) osc(ctx, "square", 40 * ratio * 2.2, hp, t, end);
}

function ride(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number): void {
  metal(ctx, out, t, vel * 0.4, 0.7, 5200);
  noiseHit(ctx, out, t, vel * 0.08, 0.5, "bandpass", 7500, 1.2);
  const ping = envGain(ctx, out);
  ping.gain.setValueAtTime(vel * 0.05, t);
  ping.gain.setTargetAtTime(0, t, 0.2);
  osc(ctx, "sine", 3700, ping, t, t + 0.8);
}

function brush(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, vel: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 3200;
  bp.Q.value = 0.6;
  const amp = envGain(ctx, out);
  src.connect(bp).connect(amp);
  const peak = vel * 0.12;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(peak, t + dur * 0.45);
  amp.gain.linearRampToValueAtTime(0, t + dur);
  src.start(t, Math.random());
  src.stop(t + dur + 0.05);
}

function noiseHit(
  ctx: BaseAudioContext, out: AudioNode, t: number, vel: number, decay: number,
  type: BiquadFilterType, freq: number, q: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const amp = envGain(ctx, out);
  src.connect(filter).connect(amp);
  amp.gain.setValueAtTime(vel, t);
  amp.gain.setTargetAtTime(0, t + 0.002, decay / 3);
  src.start(t, Math.random());
  src.stop(t + decay * 2 + 0.05);
}

function click(ctx: BaseAudioContext, out: AudioNode, t: number, vel: number): void {
  const amp = envGain(ctx, out);
  amp.gain.setValueAtTime(vel * 0.4, t);
  amp.gain.setTargetAtTime(0, t, 0.015);
  osc(ctx, "sine", vel > 0.9 ? 1600 : 1100, amp, t, t + 0.1);
}
