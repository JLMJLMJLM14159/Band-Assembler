// Turns chords into notes: piano voicings and comping, bass lines and drum grooves for each style.

import { Chord } from "./theory";
import { STYLES } from "./styles";

export type Instrument =
  | "piano" | "bass"
  | "kick" | "snare" | "rim" | "hat" | "hatOpen" | "pedal" | "ride" | "crash"
  | "brush" | "brushTap" | "tom" | "shaker" | "click";

export interface NoteEvent {
  inst: Instrument;
  /** Beats from the start of the bar. */
  time: number;
  /** Length in beats. */
  dur: number;
  /** 0..1 */
  vel: number;
  /** MIDI notes for pitched parts. */
  notes?: number[];
}

export interface Span {
  chord: Chord | null;
  beat: number;
  beats: number;
}

export interface BarSlot {
  beats: number;
  spans: Span[];
  /** First chord of the following bar, for anticipations and bass approach notes. */
  nextChord: Chord | null;
  /** Bars since the start of the chorus. */
  position: number;
  sectionStart: boolean;
  sectionEnd: boolean;
  /** Last bar before the band stops. */
  final: boolean;
}

export interface ArrangerState {
  voicing: number[] | null;
  bass: number;
  rand: () => number;
}

export function newArrangerState(seed = Date.now()): ArrangerState {
  return { voicing: null, bass: 40, rand: mulberry32(seed) };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function arrangeBar(style: string, slot: BarSlot, state: ArrangerState): NoteEvent[] {
  const info = STYLES[style] ?? STYLES["Medium Swing"];
  const ctx: Ctx = { slot, state, info, swing: info.swing, events: [] };
  switch (style) {
    case "Ballad":
      compBallad(ctx);
      bassTwoFeel(ctx);
      drumsBallad(ctx);
      break;
    case "Bossa Nova":
      compBossa(ctx);
      bassBossa(ctx);
      drumsBossa(ctx);
      break;
    case "Even 8ths":
      compEven(ctx);
      bassEven(ctx);
      drumsEven(ctx, false);
      break;
    case "Rock":
      compRock(ctx);
      bassRock(ctx);
      drumsEven(ctx, true);
      break;
    case "Funk":
      compFunk(ctx);
      bassFunk(ctx);
      drumsFunk(ctx);
      break;
    case "Jazz Waltz":
    case "Up Tempo Swing":
    case "Medium Swing":
    default:
      compSwing(ctx);
      bassWalk(ctx);
      drumsSwing(ctx);
  }
  return ctx.events;
}

interface Ctx {
  slot: BarSlot;
  state: ArrangerState;
  info: { swing: number; jazzVoicings: boolean };
  swing: number;
  events: NoteEvent[];
}

// ---- Helpers ---------------------------------------------------------------

/** Beat position of the n-th eighth note, with swing. */
function eighth(ctx: Ctx, n: number): number {
  return Math.floor(n / 2) + (n % 2 ? ctx.swing : 0);
}

function add(ctx: Ctx, inst: Instrument, time: number, dur: number, vel: number, notes?: number[]): void {
  if (time < 0 || time >= ctx.slot.beats) return;
  const jitter = (ctx.state.rand() - 0.5) * 0.1;
  ctx.events.push({ inst, time, dur, vel: clamp(vel + jitter * 0.6, 0.05, 1), notes });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function pick<T>(ctx: Ctx, items: T[]): T {
  return items[Math.floor(ctx.state.rand() * items.length)];
}

function chance(ctx: Ctx, p: number): boolean {
  return ctx.state.rand() < p;
}

/** Chord sounding at a beat. Off-beat hits just before a change anticipate the next chord. */
function chordAt(ctx: Ctx, beat: number, anticipate = true): Chord | null {
  const look = anticipate && beat % 1 !== 0 ? beat + 0.45 : beat;
  if (look >= ctx.slot.beats) return ctx.slot.nextChord ?? spanAt(ctx, ctx.slot.beats - 0.01)?.chord ?? null;
  return spanAt(ctx, look)?.chord ?? null;
}

function spanAt(ctx: Ctx, beat: number): Span | undefined {
  return ctx.slot.spans.find((s) => beat >= s.beat && beat < s.beat + s.beats);
}

/** Comps a list of hits (beat, length, velocity), making sure every chord change is played. */
function compHits(ctx: Ctx, hits: Array<[number, number, number]>, rootless = ctx.info.jazzVoicings): void {
  const all = [...hits];
  for (const span of ctx.slot.spans) {
    if (!span.chord) continue;
    const covered = all.some(([t]) => {
      const c = chordAt(ctx, t);
      return c === span.chord && t >= span.beat - 0.5 && t < span.beat + span.beats;
    });
    if (!covered) all.push([span.beat, Math.min(span.beats, 1.5) * 0.9, 0.55]);
  }
  all.sort((a, b) => a[0] - b[0]);
  for (const [t, len, vel] of all) {
    const chord = chordAt(ctx, t);
    if (!chord) continue;
    const voicing = voiceChord(chord, ctx.state.voicing, rootless);
    ctx.state.voicing = voicing;
    add(ctx, "piano", t, len, vel, voicing);
  }
}

// ---- Voicings --------------------------------------------------------------

function pcsFor(chord: Chord, rootless: boolean): number[] {
  const has = (n: number) => chord.intervals.includes(n);
  const third = has(3) ? 3 : has(4) ? 4 : has(5) ? 5 : has(2) ? 2 : null;
  const seventh = has(11) ? 11 : has(10) ? 10 : chord.family === "dim" && has(9) ? 9 : has(9) ? 9 : null;
  const fifth = has(7) ? 7 : has(6) ? 6 : has(8) ? 8 : null;

  if (chord.family === "power") return [0, 7];

  if (!rootless || !chord.hasSeventh) {
    const tones = [0, third, fifth, seventh].filter((x): x is number => x !== null);
    if (has(14) && tones.length < 4) tones.push(2);
    return tones;
  }

  // Rootless: guide tones plus two colour tones.
  const ninth = has(13) ? 1 : has(15) ? 3 : has(14) ? 2 : chord.family === "halfdim" || chord.family === "dim" ? null : 2;
  let colour = fifth;
  if (has(21)) colour = 9;
  else if (has(20)) colour = 8;
  else if (has(18)) colour = 6;
  else if (chord.family === "dominant" && !has(8) && !has(6) && !has(13)) colour = 9;
  const tones = [third, seventh, ninth, colour].filter((x): x is number => x !== null);
  if (chord.family === "halfdim") tones.push(0);
  return [...new Set(tones)];
}

/** Closest voicing (by total movement) to the previous one, kept in a comfortable middle register. */
export function voiceChord(chord: Chord, prev: number[] | null, rootless: boolean): number[] {
  const pcs = pcsFor(chord, rootless).map((x) => (x + chord.root) % 12);
  const low = 50;
  const high = 76;
  let best: number[] = [];
  let bestCost = Infinity;
  for (let rot = 0; rot < pcs.length; rot++) {
    const order = [...pcs.slice(rot), ...pcs.slice(0, rot)];
    for (let base = 48; base <= 66; base++) {
      if (base % 12 !== order[0]) continue;
      const notes = [base];
      for (let k = 1; k < order.length; k++) {
        let n = notes[k - 1] + 1;
        while (n % 12 !== order[k]) n++;
        notes.push(n);
      }
      if (notes[0] < low || notes[notes.length - 1] > high) continue;
      const cost = voicingCost(notes, prev);
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
  }
  return best.length ? best : pcs.map((p) => 60 + p);
}

function voicingCost(notes: number[], prev: number[] | null): number {
  const centre = notes.reduce((a, b) => a + b, 0) / notes.length;
  let cost = Math.abs(centre - 63) * 0.6;
  // Seconds sound muddy low down.
  for (let k = 1; k < notes.length; k++) if (notes[k] - notes[k - 1] <= 2 && notes[k - 1] < 55) cost += 4;
  if (prev && prev.length) {
    const pCentre = prev.reduce((a, b) => a + b, 0) / prev.length;
    cost += Math.abs(centre - pCentre) * 1.5;
    for (const n of notes) cost += Math.min(...prev.map((p) => Math.abs(p - n))) * 0.8;
  }
  return cost;
}

// ---- Bass ------------------------------------------------------------------

const BASS_LOW = 28;
const BASS_HIGH = 52;

function nearest(pc: number, to: number, lo = BASS_LOW, hi = BASS_HIGH): number {
  let best = lo;
  let dist = Infinity;
  for (let n = lo; n <= hi; n++) {
    if (n % 12 !== ((pc % 12) + 12) % 12) continue;
    const d = Math.abs(n - to);
    if (d < dist) {
      dist = d;
      best = n;
    }
  }
  return best;
}

function bassRoot(chord: Chord): number {
  return chord.bass ?? chord.root;
}

function chordTonesIn(chord: Chord): number[] {
  const out: number[] = [];
  const pcs = [0, ...chord.intervals.filter((i) => i < 12 && i !== 0)].map((i) => (i + chord.root) % 12);
  for (let n = BASS_LOW; n <= BASS_HIGH; n++) if (pcs.includes(n % 12)) out.push(n);
  return out;
}

function bassNote(ctx: Ctx, time: number, dur: number, note: number, vel = 0.8): void {
  ctx.state.bass = note;
  add(ctx, "bass", time, dur, vel, [note]);
}

function nextSpanChord(ctx: Ctx, index: number): Chord | null {
  for (let k = index + 1; k < ctx.slot.spans.length; k++) if (ctx.slot.spans[k].chord) return ctx.slot.spans[k].chord;
  return ctx.slot.nextChord;
}

function bassWalk(ctx: Ctx): void {
  const up = ctx.info.swing < 0.6;
  ctx.slot.spans.forEach((span, index) => {
    const chord = span.chord;
    if (!chord) return;
    const next = nextSpanChord(ctx, index);
    let note = nearest(bassRoot(chord), ctx.state.bass > 46 ? ctx.state.bass - 7 : ctx.state.bass);
    const target = next ? nearest(bassRoot(next), note) : note;
    for (let k = 0; k < span.beats; k++) {
      const t = span.beat + k;
      const last = k === span.beats - 1;
      if (k > 0) {
        if (last && next) {
          // Approach the next root chromatically or from a fifth above.
          const options = [target - 1, target + 1, target + 7 <= BASS_HIGH ? target + 7 : target - 5];
          note = pick(ctx, chance(ctx, 0.65) ? options.slice(0, 2) : options);
          if (note === ctx.state.bass) note = target + (note > target ? -1 : 1);
        } else {
          const tones = chordTonesIn(chord).filter((n) => n !== ctx.state.bass && Math.abs(n - ctx.state.bass) <= 7);
          const towards = tones.filter((n) => Math.sign(n - ctx.state.bass) === Math.sign(target - ctx.state.bass || 1));
          note = pick(ctx, towards.length ? towards : tones.length ? tones : [note]);
        }
      }
      bassNote(ctx, t, up ? 0.8 : 0.92, clamp(note, BASS_LOW, BASS_HIGH), k === 0 ? 0.85 : 0.72);
    }
  });
}

function bassTwoFeel(ctx: Ctx): void {
  ctx.slot.spans.forEach((span, index) => {
    if (!span.chord) return;
    const root = nearest(bassRoot(span.chord), ctx.state.bass);
    bassNote(ctx, span.beat, Math.min(2, span.beats) * 0.95, root, 0.75);
    if (span.beats >= 4) {
      const next = nextSpanChord(ctx, index);
      const fifth = nearest(span.chord.root + 7, root);
      const approach = next ? nearest(bassRoot(next), root) + (chance(ctx, 0.5) ? 1 : -1) : fifth;
      bassNote(ctx, span.beat + 2, 1.9, chance(ctx, 0.6) ? fifth : approach, 0.68);
    }
  });
}

function bassBossa(ctx: Ctx): void {
  for (const span of ctx.slot.spans) {
    if (!span.chord) continue;
    const root = nearest(bassRoot(span.chord), 38);
    const fifth = nearest(span.chord.root + 7, root - 5);
    bassNote(ctx, span.beat, 1.4, root, 0.82);
    if (span.beats >= 2) bassNote(ctx, span.beat + 1.5, 0.45, fifth, 0.6);
    if (span.beats >= 4) bassNote(ctx, span.beat + 2, 1.4, fifth, 0.75);
    if (span.beats >= 4) bassNote(ctx, span.beat + 3.5, 0.45, root, 0.6);
  }
}

function bassEven(ctx: Ctx): void {
  for (const span of ctx.slot.spans) {
    if (!span.chord) continue;
    const root = nearest(bassRoot(span.chord), 36);
    bassNote(ctx, span.beat, 1.4, root, 0.85);
    if (span.beats >= 2) bassNote(ctx, span.beat + 1.5, 0.45, root, 0.6);
    if (span.beats >= 3) bassNote(ctx, span.beat + 2, 0.9, chance(ctx, 0.5) ? root + 12 : nearest(span.chord.root + 7, root), 0.72);
    if (span.beats >= 4) bassNote(ctx, span.beat + 3, 0.9, root, 0.7);
  }
}

function bassRock(ctx: Ctx): void {
  for (const span of ctx.slot.spans) {
    if (!span.chord) continue;
    const root = nearest(bassRoot(span.chord), 36);
    for (let e = 0; e < span.beats * 2; e++) bassNote(ctx, span.beat + e / 2, 0.42, root, e % 2 ? 0.62 : 0.82);
  }
}

function bassFunk(ctx: Ctx): void {
  // Sixteenth positions with scale degrees (0 root, 12 octave, 7 fifth, 10 flat seven).
  const pattern: Array<[number, number, number]> = [
    [0, 0, 0.95], [3, 12, 0.6], [6, 0, 0.75], [8, 7, 0.65], [10, 10, 0.6], [11, 12, 0.7], [14, 0, 0.7],
  ];
  for (const span of ctx.slot.spans) {
    if (!span.chord) continue;
    const root = nearest(bassRoot(span.chord), 33, 28, 40);
    const minorish = span.chord.intervals.includes(3);
    for (const [six, deg, vel] of pattern) {
      const t = span.beat + six / 4;
      if (t >= span.beat + span.beats) continue;
      const d = deg === 10 && !minorish && span.chord.family !== "dominant" ? 12 : deg;
      bassNote(ctx, t, 0.22, root + d, vel);
    }
  }
}

// ---- Piano -----------------------------------------------------------------

function compSwing(ctx: Ctx): void {
  const b = ctx.slot.beats;
  if (b !== 4) {
    // Waltz and odd metres: beat one, then a push on a later beat.
    const hits: Array<[number, number, number]> = [[0, 0.9, 0.6]];
    if (chance(ctx, 0.7)) hits.push([eighth(ctx, pick(ctx, [3, 4, 5].filter((e) => e < b * 2))), 0.5, 0.5]);
    compHits(ctx, hits);
    return;
  }
  const patterns: Array<Array<[number, number, number]>> = [
    [[0, 1.2, 0.62], [eighth(ctx, 3), 0.5, 0.55]], // Charleston
    [[eighth(ctx, 1), 0.6, 0.55], [eighth(ctx, 5), 0.6, 0.5]],
    [[1, 0.5, 0.5], [3, 0.5, 0.52]],
    [[eighth(ctx, 7), 0.6, 0.6]],
    [[0, 2.5, 0.55]],
    [[eighth(ctx, 3), 0.5, 0.55], [eighth(ctx, 7), 0.5, 0.58]],
    [[0, 0.5, 0.55], [2, 0.5, 0.5], [eighth(ctx, 7), 0.4, 0.55]],
  ];
  compHits(ctx, pick(ctx, patterns));
}

function compBallad(ctx: Ctx): void {
  const hits: Array<[number, number, number]> = [];
  for (const span of ctx.slot.spans) {
    hits.push([span.beat, span.beats * 0.98, 0.5]);
    if (span.beats >= 4 && chance(ctx, 0.4)) hits.push([span.beat + 2 + ctx.swing, 1.2, 0.38]);
  }
  compHits(ctx, hits);
}

function compBossa(ctx: Ctx): void {
  const even = ctx.slot.position % 2 === 0;
  const eighths = even ? [0, 3, 6] : [1, 4, 6];
  compHits(ctx, eighths.filter((e) => e < ctx.slot.beats * 2).map((e) => [e / 2, 0.42, e === 0 ? 0.55 : 0.48]));
}

function compEven(ctx: Ctx): void {
  const hits: Array<[number, number, number]> = [[0, 1.4, 0.55]];
  if (ctx.slot.beats >= 2) hits.push([1.5, 0.9, 0.45]);
  if (ctx.slot.beats >= 4) hits.push([3, 0.9, 0.45]);
  compHits(ctx, hits, false);
}

function compRock(ctx: Ctx): void {
  const hits: Array<[number, number, number]> = [];
  for (let t = 0; t < ctx.slot.beats; t++) hits.push([t, 0.7, t % 2 ? 0.45 : 0.55]);
  if (chance(ctx, 0.3)) hits.push([ctx.slot.beats - 0.5, 0.45, 0.5]);
  compHits(ctx, hits, false);
}

function compFunk(ctx: Ctx): void {
  const sixteenths = pick(ctx, [[0, 3, 6, 10, 12], [2, 6, 9, 14], [0, 6, 10, 11, 14]]);
  compHits(ctx, sixteenths.filter((s) => s < ctx.slot.beats * 4).map((s) => [s / 4, 0.2, s % 4 === 0 ? 0.55 : 0.48]));
}

// ---- Drums -----------------------------------------------------------------

function crashIfSection(ctx: Ctx, vel = 0.5): boolean {
  if (ctx.slot.sectionStart && ctx.slot.position > 0) {
    add(ctx, "crash", 0, 2, vel);
    return true;
  }
  return false;
}

function drumsSwing(ctx: Ctx): void {
  const b = ctx.slot.beats;
  const crashed = crashIfSection(ctx, 0.4);
  for (let beat = 0; beat < b; beat++) {
    if (!(crashed && beat === 0)) add(ctx, "ride", beat, 1, beat % 2 ? 0.62 : 0.5);
    if (beat % 2 === 1) add(ctx, "ride", beat + ctx.swing, 0.5, 0.42);
    add(ctx, "kick", beat, 0.5, 0.18);
    if ((b === 3 && beat > 0) || (b !== 3 && beat % 2 === 1)) add(ctx, "pedal", beat, 0.3, 0.55);
  }
  if (ctx.slot.sectionEnd && !ctx.slot.final) {
    // A short snare fill into the next section.
    add(ctx, "snare", b - 2 + ctx.swing, 0.3, 0.4);
    add(ctx, "snare", b - 1, 0.3, 0.5);
    add(ctx, "snare", b - 1 + ctx.swing, 0.3, 0.6);
    add(ctx, "kick", b - 1 + ctx.swing, 0.3, 0.5);
  } else if (chance(ctx, 0.35)) {
    add(ctx, "snare", eighth(ctx, pick(ctx, [3, 5, 7].filter((e) => e < b * 2))), 0.3, 0.22);
  }
}

function drumsBallad(ctx: Ctx): void {
  const b = ctx.slot.beats;
  crashIfSection(ctx, 0.25);
  for (let beat = 0; beat < b; beat++) {
    add(ctx, "brush", beat, 1, beat % 2 ? 0.35 : 0.28);
    if (beat % 2 === 1) {
      add(ctx, "brushTap", beat, 0.3, 0.4);
      add(ctx, "pedal", beat, 0.3, 0.4);
    }
  }
  add(ctx, "kick", 0, 0.5, 0.25);
}

function drumsBossa(ctx: Ctx): void {
  const b = ctx.slot.beats;
  crashIfSection(ctx, 0.3);
  const even = ctx.slot.position % 2 === 0;
  const rim = even ? [0, 3, 6] : [2, 5];
  for (const e of rim) add(ctx, "rim", e / 2, 0.2, 0.55);
  for (let e = 0; e < b * 2; e++) add(ctx, "hat", e / 2, 0.2, e % 2 ? 0.25 : 0.4);
  for (let beat = 0; beat < b; beat += 2) {
    add(ctx, "kick", beat, 0.5, 0.6);
    add(ctx, "kick", beat + 1.5, 0.4, 0.35);
  }
}

function drumsEven(ctx: Ctx, rock: boolean): void {
  const b = ctx.slot.beats;
  const crashed = crashIfSection(ctx, rock ? 0.7 : 0.5);
  for (let e = 0; e < b * 2; e++) {
    if (crashed && e === 0) continue;
    const open = rock && e === b * 2 - 1 && chance(ctx, 0.25);
    add(ctx, open ? "hatOpen" : "hat", e / 2, 0.3, e % 2 ? 0.32 : 0.5);
  }
  for (let beat = 0; beat < b; beat++) {
    if (beat % 2 === 0) add(ctx, "kick", beat, 0.5, rock ? 0.9 : 0.75);
    else add(ctx, "snare", beat, 0.4, rock ? 0.85 : 0.6);
  }
  if (chance(ctx, 0.4)) add(ctx, "kick", 2.5, 0.4, 0.55);
  if (ctx.slot.sectionEnd && !ctx.slot.final && b >= 4) {
    const toms = [50, 50, 45, 45, 41, 41, 38, 38];
    for (let k = 0; k < 8; k++) add(ctx, k < 2 ? "snare" : "tom", b - 2 + k / 4, 0.3, 0.5 + k * 0.04, [toms[k]]);
  }
}

function drumsFunk(ctx: Ctx): void {
  const b = ctx.slot.beats;
  crashIfSection(ctx, 0.5);
  for (let s = 0; s < b * 4; s++) add(ctx, "hat", s / 4, 0.15, s % 2 ? 0.22 : 0.42);
  for (let beat = 1; beat < b; beat += 2) add(ctx, "snare", beat, 0.4, 0.85);
  for (const s of [0, 3, 10, 13]) if (s < b * 4) add(ctx, "kick", s / 4, 0.4, s === 0 ? 0.9 : 0.7);
  for (const s of [7, 9, 15]) if (s < b * 4 && chance(ctx, 0.6)) add(ctx, "snare", s / 4, 0.2, 0.15);
}

/** One bar of clicks before the band comes in. */
export function countIn(beats: number): NoteEvent[] {
  return Array.from({ length: beats }, (_, k) => ({ inst: "click" as const, time: k, dur: 0.1, vel: k === 0 ? 1 : 0.7 }));
}

/** A final chord on the downbeat after the last bar. */
export function endingChord(chord: Chord | null, state: ArrangerState, rootless: boolean): NoteEvent[] {
  if (!chord) return [];
  const voicing = voiceChord(chord, state.voicing, rootless);
  const root = nearest(bassRoot(chord), state.bass);
  return [
    { inst: "piano", time: 0, dur: 3, vel: 0.6, notes: voicing },
    { inst: "bass", time: 0, dur: 3, vel: 0.8, notes: [root] },
    { inst: "crash", time: 0, dur: 3, vel: 0.5 },
    { inst: "kick", time: 0, dur: 0.5, vel: 0.6 },
  ];
}
