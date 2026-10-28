// The chart model, the playback order it implies, and the downloadable file format.

export interface Bar {
  /** Chord tokens: chord symbols, "/" to hold the previous chord a beat, "%" to repeat the previous bar, "NC" for no chord. */
  chords: string[];
  section?: string;
  repeatStart?: boolean;
  repeatEnd?: boolean;
  /** Starts the bracket for this ending number (1, 2, 3). */
  ending?: number;
  /** Time signature change starting at this bar, e.g. "3/4". */
  timeSig?: string;
  segno?: boolean;
  coda?: boolean;
  /** Free text shown above the bar. "D.C. al Coda", "D.S. al Fine", "Fine" etc. also steer playback. */
  comment?: string;
  finalBar?: boolean;
}

export interface Song {
  title: string;
  composer: string;
  style: string;
  /** Key the chart is written in, e.g. "F" or "D-". */
  key: string;
  /** Semitones to transpose for playback and display. */
  transpose: number;
  tempo: number;
  timeSig: string;
  bars: Bar[];
}

export function newSong(): Song {
  return {
    title: "Untitled",
    composer: "",
    style: "Medium Swing",
    key: "C",
    transpose: 0,
    tempo: 140,
    timeSig: "4/4",
    bars: Array.from({ length: 16 }, () => ({ chords: [] })),
  };
}

export function parseTimeSig(sig: string | undefined): { beats: number; unit: number } {
  const m = /^(\d+)\/(\d+)$/.exec(sig ?? "");
  if (!m) return { beats: 4, unit: 4 };
  return { beats: Math.max(1, +m[1]), unit: +m[2] || 4 };
}

/** Time signature in force at each bar. */
export function barTimeSigs(song: Song): string[] {
  let current = song.timeSig;
  return song.bars.map((bar) => (current = bar.timeSig || current));
}

/** Chord tokens a bar actually plays, following "%" back to the bar it repeats. */
export function resolvedChords(song: Song, index: number): string[] {
  for (let i = index; i >= 0; i--) {
    const chords = song.bars[i].chords;
    if (!(chords.length === 1 && chords[0] === "%")) return chords;
  }
  return [];
}

export interface ChordSpan {
  symbol: string;
  /** Beat offset inside the bar. */
  beat: number;
  beats: number;
}

/**
 * Lays a bar's tokens out in beats. When there is one token per beat each gets a beat;
 * otherwise chords share the bar evenly, with any spare beats going to the first chords.
 */
export function chordSpans(tokens: string[], beats: number): ChordSpan[] {
  if (tokens.length === 0) return [];
  const slots: number[] = [];
  if (tokens.length === beats) {
    tokens.forEach(() => slots.push(1));
  } else {
    const base = Math.floor(beats / tokens.length);
    let spare = beats - base * tokens.length;
    tokens.forEach(() => {
      slots.push(Math.max(base, 0) + (spare > 0 ? 1 : 0));
      if (spare > 0) spare--;
    });
  }
  const spans: ChordSpan[] = [];
  let beat = 0;
  tokens.forEach((token, i) => {
    const length = slots[i];
    if (length <= 0) return;
    if (token === "/" && spans.length > 0) spans[spans.length - 1].beats += length;
    else if (token !== "/") spans.push({ symbol: token, beat, beats: length });
    beat += length;
  });
  return spans;
}

const JUMP_RE = /\bD\.?\s?([CS])\.?/i;

/**
 * Bar indexes in the order they are played for one chorus: repeats, numbered endings,
 * and D.C./D.S. al Coda / al Fine.
 */
export function playbackOrder(song: Song): number[] {
  const bars = song.bars;
  const order: number[] = [];
  let repeatStart = 0;
  let pass = 1;
  let jumped = false;
  let jumpMode: "" | "coda" | "fine" = "";
  let i = 0;
  const limit = bars.length * 16;

  // A repeat is played as many times as its highest numbered ending, and at least twice.
  const passesFor = (start: number): number => {
    let most = 2;
    for (let j = start; j < bars.length; j++) {
      if (j > start && bars[j].repeatStart) break;
      if (bars[j].ending) most = Math.max(most, bars[j].ending!);
    }
    return most;
  };

  while (i < bars.length && order.length < limit) {
    const bar = bars[i];
    if (bar.repeatStart && repeatStart !== i) {
      repeatStart = i;
      // After a D.C./D.S. jump, repeats are not taken again: go straight to the last ending.
      pass = jumped ? passesFor(i) : 1;
    }

    if (bar.ending && bar.ending !== pass) {
      // Skip to the ending for this pass, or past this ending block if there is none.
      let j = i + 1;
      while (j < bars.length && bars[j].ending !== pass) j++;
      if (j >= bars.length) {
        j = i;
        while (j < bars.length && !bars[j].repeatEnd) j++;
        j++;
      }
      i = j;
      continue;
    }

    order.push(i);
    const comment = bar.comment ?? "";

    if (jumped && jumpMode === "fine" && /\bfine\b/i.test(comment) && !JUMP_RE.test(comment)) break;
    if (jumped && jumpMode === "coda" && bar.coda) {
      let j = i + 1;
      while (j < bars.length && !bars[j].coda) j++;
      if (j < bars.length) {
        jumpMode = "";
        i = j;
        continue;
      }
    }

    if (bar.repeatEnd && !jumped) {
      if (pass < passesFor(repeatStart)) {
        pass++;
        i = repeatStart;
        continue;
      }
      pass = 1;
    }

    const jump = JUMP_RE.exec(comment);
    if (jump && !jumped) {
      jumped = true;
      jumpMode = /coda/i.test(comment) ? "coda" : /fine/i.test(comment) ? "fine" : "";
      const segno = bars.findIndex((b) => b.segno);
      i = jump[1].toUpperCase() === "S" && segno >= 0 ? segno : 0;
      repeatStart = i;
      pass = passesFor(i);
      continue;
    }
    if (bar.finalBar) break;
    i++;
  }
  return order;
}

// ---- Files -----------------------------------------------------------------

export const FILE_FORMAT = "band-assembler";
export const FILE_VERSION = 1;

export interface SongFile {
  format: typeof FILE_FORMAT;
  version: number;
  songs: Song[];
}

export function toFile(songs: Song[]): string {
  const file: SongFile = { format: FILE_FORMAT, version: FILE_VERSION, songs };
  return JSON.stringify(file, null, 2);
}

/** Reads a Band Assembler file. Throws with a readable message if it is not one. */
export function fromFile(text: string): Song[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not a Band Assembler chart.");
  }
  const file = data as Partial<SongFile>;
  if (!file || file.format !== FILE_FORMAT || !Array.isArray(file.songs)) {
    throw new Error("This file is not a Band Assembler chart.");
  }
  return file.songs.map(normaliseSong);
}

function normaliseSong(raw: Partial<Song>): Song {
  const base = newSong();
  return {
    title: String(raw.title ?? base.title),
    composer: String(raw.composer ?? ""),
    style: String(raw.style ?? base.style),
    key: String(raw.key ?? base.key),
    transpose: Number(raw.transpose) || 0,
    tempo: Number(raw.tempo) || base.tempo,
    timeSig: String(raw.timeSig ?? base.timeSig),
    bars: Array.isArray(raw.bars)
      ? raw.bars.map((b) => ({ ...b, chords: Array.isArray(b.chords) ? b.chords.map(String) : [] }))
      : base.bars,
  };
}
