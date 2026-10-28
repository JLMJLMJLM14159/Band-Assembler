// Walks a chart in playback order and asks the arranger for each bar's notes.

import { arrangeBar, countIn, endingChord, newArrangerState, NoteEvent, Span } from "./arranger";
import { barTimeSigs, chordSpans, parseTimeSig, playbackOrder, resolvedChords, Song } from "./song";
import { STYLES } from "./styles";
import { Chord, keyPrefersFlats, parseChord, parseKey, transposeKey, transposeSymbol } from "./theory";

export interface LiveSettings {
  song: Song;
  /** Choruses to play; 0 loops until stopped. */
  choruses: number;
  /** Tempo added after each chorus. */
  tempoStep: number;
  countIn: boolean;
}

export interface PerformedBar {
  /** Chart bar index, or -1 for the count-in and -2 for the closing chord. */
  chartIndex: number;
  chorus: number;
  beats: number;
  beatSec: number;
  events: NoteEvent[];
}

/** Reads `live` before every bar, so edits to the chart, tempo or style are heard straight away. */
export function* perform(live: LiveSettings, seed = Date.now()): Generator<PerformedBar> {
  const state = newArrangerState(seed);
  let lastChord: Chord | null = null;

  for (let chorus = 0; live.choruses === 0 || chorus < live.choruses; chorus++) {
    const song = live.song;
    const order = playbackOrder(song);
    if (order.length === 0) return;

    if (chorus === 0 && live.countIn) {
      const sig = parseTimeSig(barTimeSigs(song)[order[0]]);
      yield { chartIndex: -1, chorus, beats: sig.beats, beatSec: beatSeconds(song.tempo, sig.unit), events: countIn(sig.beats) };
    }

    for (let k = 0; k < order.length; k++) {
      const song = live.song;
      const index = order[k];
      if (index >= song.bars.length) continue;
      const sig = parseTimeSig(barTimeSigs(song)[index]);
      const tempo = song.tempo + chorus * live.tempoStep;
      const finalChorus = live.choruses !== 0 && chorus === live.choruses - 1;
      const isLast = k === order.length - 1;

      const spans = barSpans(song, index, sig.beats, lastChord);
      if (spans.length) lastChord = spans[spans.length - 1].chord ?? lastChord;

      const nextIndex = isLast ? (finalChorus ? -1 : order[0]) : order[k + 1];
      const nextChord = nextIndex >= 0 && nextIndex < song.bars.length ? barSpans(song, nextIndex, 4, lastChord)[0]?.chord ?? null : null;
      const nextBar = nextIndex >= 0 ? song.bars[nextIndex] : undefined;

      const events = arrangeBar(
        song.style,
        {
          beats: sig.beats,
          spans,
          nextChord,
          position: k,
          sectionStart: k === 0 || !!song.bars[index].section,
          sectionEnd: isLast || !!nextBar?.section,
          final: finalChorus && isLast,
        },
        state,
      );
      yield { chartIndex: index, chorus, beats: sig.beats, beatSec: beatSeconds(tempo, sig.unit), events };

      if (finalChorus && isLast) {
        const rootless = STYLES[song.style]?.jazzVoicings ?? true;
        yield { chartIndex: -2, chorus, beats: 4, beatSec: beatSeconds(tempo, 4), events: endingChord(lastChord, state, rootless) };
      }
    }
  }
}

function beatSeconds(tempo: number, unit: number): number {
  return (60 / Math.max(20, tempo)) * (4 / unit);
}

/** The chords of one bar, transposed and parsed. An empty bar keeps the previous chord going. */
export function barSpans(song: Song, index: number, beats: number, previous: Chord | null): Span[] {
  const target = transposeKey(parseKey(song.key), song.transpose);
  const flats = keyPrefersFlats(target);
  const tokens = resolvedChords(song, index);
  if (tokens.length === 0) return previous ? [{ chord: previous, beat: 0, beats }] : [];
  return chordSpans(tokens, beats).map((span) => ({
    chord: /^n\.?c\.?$/i.test(span.symbol) ? null : parseChord(transposeSymbol(span.symbol, song.transpose, flats)),
    beat: span.beat,
    beats: span.beats,
  }));
}

/** Total length in seconds of a fixed number of choruses, used to size an audio render. */
export function performanceLength(live: LiveSettings): number {
  if (live.choruses === 0) return 0;
  let seconds = 0;
  for (const bar of perform(live, 1)) seconds += bar.beats * bar.beatSec;
  return seconds;
}
