// Starter charts: common progressions to try the band with.

import { Bar, Song } from "./song";

/** "F7 | Bb7 | C-7 F7" → bars. */
function bars(text: string): Bar[] {
  return text.split("|").map((b) => ({ chords: b.trim().split(/\s+/).filter(Boolean) }));
}

function mark(list: Bar[], index: number, extra: Partial<Bar>): Bar[] {
  list[index] = { ...list[index], ...extra };
  return list;
}

export function exampleSongs(): Song[] {
  const blues = bars("F7 | Bb7 | F7 | C-7 F7 | Bb7 | Bdim7 | F7 | D-7 G7 | G-7 | C7 | F7 D7 | G-7 C7");
  mark(blues, 0, { section: "A" });

  const rhythm = [
    ...bars("Bbmaj7 G-7 | C-7 F7 | D-7 G7 | C-7 F7 | F-7 Bb7 | Ebmaj7 Ab7"),
    ...bars("D-7 G7 | C-7 F7"),
    ...bars("C-7 F7 | Bb6"),
    ...bars("D7 | % | G7 | % | C7 | % | F7 | %"),
    ...bars("Bbmaj7 G-7 | C-7 F7 | D-7 G7 | C-7 F7 | F-7 Bb7 | Ebmaj7 Ab7 | C-7 F7 | Bb6"),
  ];
  mark(rhythm, 0, { section: "A", repeatStart: true });
  mark(rhythm, 6, { ending: 1 });
  mark(rhythm, 7, { repeatEnd: true });
  mark(rhythm, 8, { ending: 2 });
  mark(rhythm, 10, { section: "B" });
  mark(rhythm, 18, { section: "A" });
  mark(rhythm, 25, { finalBar: true });

  const bossa = bars(
    "D-9 | % | E-7b5 | A7b9 | D-9 | % | G-7 | C7 | Fmaj7 | Bbmaj7 | E-7b5 | A7alt | D-6 | Bb7 | E-7b5 A7b9 | D-9",
  );
  mark(bossa, 0, { section: "A" });
  mark(bossa, 8, { section: "B" });
  mark(bossa, 15, { finalBar: true });

  const pop = bars("G | D/F# | E-7 | Cadd9 | G | D | C | C | E- | C | G | D | E- | C | D | D");
  mark(pop, 0, { section: "V" });
  mark(pop, 8, { section: "C" });
  mark(pop, 15, { finalBar: true });

  const ballad = bars("Ebmaj7 | C-7 | F-7 | Bb7 | G-7 C7 | F-7 Bb7 | Ebmaj7 Ab7 | G-7 C7 | F-7 | Bb7sus Bb7 | Ebmaj7 | %");
  mark(ballad, 0, { section: "A" });
  mark(ballad, 11, { finalBar: true });

  return [
    { title: "Blues in F", composer: "Practice", style: "Medium Swing", key: "F", transpose: 0, tempo: 140, timeSig: "4/4", bars: blues },
    { title: "Rhythm Changes", composer: "Practice", style: "Up Tempo Swing", key: "Bb", transpose: 0, tempo: 210, timeSig: "4/4", bars: rhythm },
    { title: "Minor Bossa", composer: "Practice", style: "Bossa Nova", key: "D-", transpose: 0, tempo: 130, timeSig: "4/4", bars: bossa },
    { title: "Pop Song Form", composer: "Practice", style: "Even 8ths", key: "G", transpose: 0, tempo: 96, timeSig: "4/4", bars: pop },
    { title: "Slow ii–Vs", composer: "Practice", style: "Ballad", key: "Eb", transpose: 0, tempo: 66, timeSig: "4/4", bars: ballad },
  ];
}
