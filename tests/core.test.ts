import { describe, expect, it } from "vitest";
import { arrangeBar, newArrangerState, voiceChord } from "../src/arranger";
import { exampleSongs } from "../src/examples";
import { findIRealLinks, parseIRealLink, parseMusic, unscramble } from "../src/ireal";
import { perform } from "../src/performance";
import { chordSpans, fromFile, newSong, playbackOrder, Song, toFile } from "../src/song";
import { STYLE_NAMES } from "../src/styles";
import { parseChord, transposeSymbol } from "../src/theory";

const iv = (s: string) => parseChord(s)?.intervals;

describe("chord symbols", () => {
  it("reads the common spellings", () => {
    expect(iv("C")).toEqual([0, 4, 7]);
    expect(iv("Cmaj7")).toEqual([0, 4, 7, 11]);
    expect(iv("C^7")).toEqual([0, 4, 7, 11]);
    expect(iv("CΔ")).toEqual([0, 4, 7, 11]);
    expect(iv("C-7")).toEqual([0, 3, 7, 10]);
    expect(iv("Cm7")).toEqual([0, 3, 7, 10]);
    expect(iv("Cø")).toEqual([0, 3, 6, 10]);
    expect(iv("Ch7")).toEqual([0, 3, 6, 10]);
    expect(iv("C°7")).toEqual([0, 3, 6, 9]);
    expect(iv("Co7")).toEqual([0, 3, 6, 9]);
    expect(iv("C7b9")).toEqual([0, 4, 7, 10, 13]);
    expect(iv("C7#11")).toEqual([0, 4, 7, 10, 18]);
    expect(iv("C13")).toEqual([0, 4, 7, 10, 14, 21]);
    expect(iv("C7sus")).toEqual([0, 5, 7, 10]);
    expect(iv("C-^7")).toEqual([0, 3, 7, 11]);
    expect(iv("C69")).toEqual([0, 4, 7, 9, 14]);
    expect(iv("C+")).toEqual([0, 4, 8]);
    expect(iv("C-b6")).toEqual([0, 3, 7, 8]);
    expect(iv("Cadd9")).toEqual([0, 4, 7, 14]);
    expect(parseChord("C7alt")?.family).toBe("dominant");
    expect(parseChord("D/F#")).toMatchObject({ root: 2, bass: 6 });
  });

  it("rejects nonsense", () => {
    expect(parseChord("H7")).toBeNull();
    expect(parseChord("Cxyz")).toBeNull();
  });

  it("transposes roots and bass notes with sensible spelling", () => {
    expect(transposeSymbol("C-7", 3, true)).toBe("Eb-7");
    expect(transposeSymbol("D/F#", -2, false)).toBe("C/E");
    expect(transposeSymbol("Bb7", 1, false)).toBe("B7");
  });
});

describe("bars and form", () => {
  it("shares beats between chords", () => {
    expect(chordSpans(["C", "G7"], 4).map((s) => s.beats)).toEqual([2, 2]);
    expect(chordSpans(["C", "/", "/", "G7"], 4).map((s) => [s.symbol, s.beats])).toEqual([["C", 3], ["G7", 1]]);
    expect(chordSpans(["C", "D", "E"], 4).map((s) => s.beats)).toEqual([2, 1, 1]);
  });

  it("follows repeats and numbered endings", () => {
    const song: Song = { ...newSong(), bars: [
      { chords: ["A"], repeatStart: true },
      { chords: ["B"], ending: 1, repeatEnd: true },
      { chords: ["C"], ending: 2 },
      { chords: ["D"] },
    ] };
    expect(playbackOrder(song)).toEqual([0, 1, 0, 2, 3]);
  });

  it("plays three endings", () => {
    const song: Song = { ...newSong(), bars: [
      { chords: ["A"], repeatStart: true },
      { chords: ["B"], ending: 1, repeatEnd: true },
      { chords: ["C"], ending: 2, repeatEnd: true },
      { chords: ["D"], ending: 3 },
    ] };
    expect(playbackOrder(song)).toEqual([0, 1, 0, 2, 0, 3]);
  });

  it("handles D.C. al Coda", () => {
    const song: Song = { ...newSong(), bars: [
      { chords: ["A"] },
      { chords: ["B"], coda: true },
      { chords: ["C"], comment: "D.C. al Coda", finalBar: true },
      { chords: ["D"], coda: true },
    ] };
    expect(playbackOrder(song)).toEqual([0, 1, 2, 0, 1, 3]);
  });

  it("handles D.C. al Fine", () => {
    const song: Song = { ...newSong(), bars: [
      { chords: ["A"] },
      { chords: ["B"], comment: "Fine" },
      { chords: ["C"], comment: "D.C. al Fine" },
    ] };
    expect(playbackOrder(song)).toEqual([0, 1, 2, 0, 1]);
  });

  it("plays the Rhythm Changes example as 32 bars", () => {
    const rhythm = exampleSongs().find((s) => s.title === "Rhythm Changes")!;
    expect(playbackOrder(rhythm)).toHaveLength(32);
  });
});

describe("files", () => {
  it("round-trips charts through the download format", () => {
    const songs = exampleSongs();
    expect(fromFile(toFile(songs))).toEqual(songs);
  });

  it("refuses other JSON", () => {
    expect(() => fromFile('{"hello":1}')).toThrow(/not a Band Assembler chart/);
  });
});

describe("iReal Pro import", () => {
  it("parses a music string", () => {
    const { bars, timeSig } = parseMusic("{*AT44C^7   |A-7   |N1D-7 G7 }|N2D-7 G7 |C6 Z");
    expect(timeSig).toBe("4/4");
    expect(bars.map((b) => b.chords)).toEqual([["Cmaj7"], ["A-7"], ["D-7", "G7"], ["D-7", "G7"], ["C6"]]);
    expect(bars[0]).toMatchObject({ section: "A", repeatStart: true });
    expect(bars[2]).toMatchObject({ ending: 1, repeatEnd: true });
    expect(bars[3]).toMatchObject({ ending: 2 });
    expect(bars[4]).toMatchObject({ finalBar: true });
  });

  it("reads repeat signs, no-chord and comments", () => {
    const { bars } = parseMusic("[F7   | x  |n   |C7 <D.C. al Fine>Z");
    expect(bars.map((b) => b.chords)).toEqual([["F7"], ["%"], ["NC"], ["C7"]]);
    expect(bars[3].comment).toBe("D.C. al Fine");
  });

  it("decodes an obfuscated irealb:// link", () => {
    // The scramble is its own inverse, so scrambling plain music gives us a realistic link.
    const music = "[T44*AF7XyQ|Bb7XyQ|F7XyQ|C-7 F7 |Bb7XyQ|Bo7XyQ|F7XyQ|D-7 G7 |G-7XyQ|C7XyQ|F7 D7 |G-7 C7 Z ";
    const scrambled = scramble(music);
    expect(unscramble(scrambled)).toContain("F7   |Bb7");
    const body = `Blues Test=Doe John==Medium Swing=F==1r34LbKcu7${scrambled}=Medium Swing=140=3===My Playlist`;
    const link = "irealb://" + encodeURIComponent(body);
    const [song] = parseIRealLink(link);
    expect(song.title).toBe("Blues Test");
    expect(song.composer).toBe("John Doe");
    expect(song.key).toBe("F");
    expect(song.tempo).toBe(140);
    expect(song.bars).toHaveLength(12);
    expect(song.bars[5].chords).toEqual(["Bo7"]);
    expect(parseChord(song.bars[5].chords[0])).not.toBeNull();
  });

  it("finds links inside an exported HTML page", () => {
    const html = `<a href="irealb://A%3DB%3D%3DBallad%3DC%3D%3DC%5E7%20Z">x</a>`;
    expect(findIRealLinks(html)).toHaveLength(1);
  });
});

describe("arranging", () => {
  it("keeps piano voicings close together", () => {
    const a = voiceChord(parseChord("D-7")!, null, true);
    const b = voiceChord(parseChord("G7")!, a, true);
    const moved = b.reduce((sum, n, i) => sum + Math.abs(n - (a[i] ?? n)), 0);
    expect(moved).toBeLessThan(10);
    for (const n of [...a, ...b]) expect(n).toBeGreaterThanOrEqual(48);
  });

  it("produces notes for every style", () => {
    for (const style of STYLE_NAMES) {
      const events = arrangeBar(
        style,
        {
          beats: 4,
          spans: [{ chord: parseChord("C7")!, beat: 0, beats: 4 }],
          nextChord: parseChord("F7"),
          position: 1,
          sectionStart: false,
          sectionEnd: false,
          final: false,
        },
        newArrangerState(1),
      );
      expect(events.some((e) => e.inst === "piano"), style).toBe(true);
      expect(events.some((e) => e.inst === "bass"), style).toBe(true);
      expect(events.some((e) => e.inst !== "piano" && e.inst !== "bass"), style).toBe(true);
      for (const e of events) expect(e.time).toBeLessThan(4);
    }
  });

  it("performs every example to the end with a count-in and closing chord", () => {
    for (const song of exampleSongs()) {
      const bars = [...perform({ song, choruses: 2, tempoStep: 5, countIn: true }, 7)];
      expect(bars[0].chartIndex).toBe(-1);
      expect(bars[bars.length - 1].chartIndex).toBe(-2);
      expect(bars.filter((b) => b.chartIndex >= 0)).toHaveLength(playbackOrder(song).length * 2);
    }
  });
});

function scramble(s: string): string {
  // Same transform as unscramble's block swap, applied before the substitutions.
  let out = "";
  while (s.length > 51) {
    const p = s.substring(0, 50).split("");
    const src = s.substring(0, 50);
    for (let i = 0; i < 5; i++) {
      p[49 - i] = src[i];
      p[i] = src[49 - i];
    }
    for (let i = 10; i < 24; i++) {
      p[49 - i] = src[i];
      p[i] = src[49 - i];
    }
    out += p.join("");
    s = s.substring(50);
  }
  return out + s;
}
