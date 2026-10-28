// Reads iReal Pro links (irealb:// and the older irealbook://) into songs.
// Format notes follow the community-documented layout used by open-source readers.

import { Bar, Song } from "./song";
import { STYLES, styleForIRealName } from "./styles";

const MUSIC_PREFIX = "1r34LbKcu7";

// Chord qualities iReal Pro can produce, longest first so the regex prefers full matches.
const QUALITIES = [
  "7susadd3", "7b9sus", "7b13sus", "7#9#11", "7b9#11", "7#9#5", "7#9b5", "7b9b5", "7b9#5", "7b9#9",
  "7b9b13", "^7#11", "^9#11", "13sus", "13#11", "7#11", "9#11", "7b13", "-7b5", "-^7", "-^9", "^7#5",
  "7alt", "7sus", "9sus", "13b9", "13#9", "add9", "-69", "-11", "7b9", "7#9", "7b5", "7#5", "9b5", "9#5",
  "-b6", "-#5", "^13", "^7", "^9", "-7", "-6", "-9", "h7", "h9", "o7", "69", "13", "11", "sus", "^", "-",
  "+", "o", "h", "7", "9", "6", "5", "2",
].sort((a, b) => b.length - a.length);
const CHORD_RE = new RegExp(
  "^([A-GW][b#]?)(" + QUALITIES.map((q) => q.replace(/[\^+#]/g, "\\$&")).join("|") + ")?(\\/[A-G][b#]?)?",
);

/** Finds every iReal Pro link in some text, e.g. an exported HTML playlist. */
export function findIRealLinks(text: string): string[] {
  return text.replace(/&amp;/g, "&").match(/irealb(?:ook)?:\/\/[^"'\s<>]+/g) ?? [];
}

/** Decodes one iReal Pro link, which may hold a single song or a whole playlist. */
export function parseIRealLink(link: string): Song[] {
  const trimmed = link.trim();
  const oldFormat = trimmed.startsWith("irealbook://");
  let body = trimmed.replace(/^irealb(?:ook)?:\/\//, "");
  try {
    body = decodeURIComponent(body);
  } catch {
    // Leave it as is; some exports are already decoded.
  }
  const chunks = body.split("===").filter((c) => c.trim() !== "");
  const songs: Song[] = [];
  for (const chunk of chunks) {
    const song = oldFormat ? parseOldSong(chunk) : parseSong(chunk);
    if (song) songs.push(song);
  }
  return songs;
}

function parseSong(data: string): Song | null {
  const parts = data.split("=");
  // A trailing chunk with only one field is the playlist name.
  if (parts.length < 7) return null;
  const [title, composer, , styleName, key, , rawMusic, , bpm] = parts;
  const music = rawMusic.includes(MUSIC_PREFIX) ? unscramble(rawMusic.split(MUSIC_PREFIX)[1]) : rawMusic;
  return buildSong(title, composer, styleName, key, Number(bpm) || 0, music);
}

function parseOldSong(data: string): Song | null {
  const parts = data.split("=");
  if (parts.length < 6) return null;
  const [title, composer, styleName, key, , music] = parts;
  return buildSong(title, composer, styleName, key, 0, music);
}

function buildSong(title: string, composer: string, styleName: string, key: string, bpm: number, music: string): Song {
  const style = styleForIRealName(styleName);
  const { bars, timeSig } = parseMusic(music);
  return {
    title: title.trim() || "Untitled",
    composer: formatComposer(composer.trim()),
    style,
    key: key.trim() || "C",
    transpose: 0,
    tempo: bpm || STYLES[style].tempo,
    timeSig,
    bars,
  };
}

// iReal Pro stores composers as "Last First".
function formatComposer(name: string): string {
  const words = name.split(/\s+/);
  if (words.length !== 2) return name;
  return `${words[1]} ${words[0]}`;
}

/** Undoes the light obfuscation iReal Pro applies to the music string. */
export function unscramble(s: string): string {
  let out = "";
  while (s.length > 51) {
    out += obfusc50(s.substring(0, 50));
    s = s.substring(50);
  }
  out += s;
  return out.replace(/Kcl/g, "| x").replace(/LZ/g, " |").replace(/XyQ/g, "   ");
}

function obfusc50(s: string): string {
  const chars = s.split("");
  for (let i = 0; i < 5; i++) {
    chars[49 - i] = s[i];
    chars[i] = s[49 - i];
  }
  for (let i = 10; i < 24; i++) {
    chars[49 - i] = s[i];
    chars[i] = s[49 - i];
  }
  return chars.join("");
}

const TIME_SIGS: Record<string, string> = {
  "44": "4/4", "34": "3/4", "24": "2/4", "54": "5/4", "64": "6/4", "74": "7/4",
  "22": "2/2", "32": "3/2", "58": "5/8", "68": "6/8", "78": "7/8", "98": "9/8", "12": "12/8",
};

/** Turns an (unscrambled) iReal music string into bars. */
export function parseMusic(music: string): { bars: Bar[]; timeSig: string } {
  const bars: Bar[] = [];
  let firstTimeSig = "";
  let cur: Bar = { chords: [] };
  let lastChord = "";

  const close = () => {
    if (cur.chords.length > 0) {
      bars.push(cur);
      cur = { chords: [] };
    }
  };

  let i = 0;
  while (i < music.length) {
    const rest = music.slice(i);
    const ch = music[i];

    if (ch === "*" && i + 1 < music.length) {
      const label = music[i + 1];
      cur.section = label === "i" ? "Intro" : label === "V" ? "Verse" : label;
      i += 2;
      continue;
    }
    const time = /^T(\d\d)/.exec(rest);
    if (time) {
      const sig = TIME_SIGS[time[1]] ?? "4/4";
      if (!firstTimeSig) firstTimeSig = sig;
      else cur.timeSig = sig;
      i += 3;
      continue;
    }
    const comment = /^<([^>]*)>/.exec(rest);
    if (comment) {
      const text = comment[1].replace(/^\*\d+/, "").trim();
      if (text) {
        // A comment after the last chord of a bar belongs to that bar.
        const target = cur.chords.length === 0 && bars.length > 0 && /D\.|Fine|Coda/i.test(text) ? bars[bars.length - 1] : cur;
        target.comment = target.comment ? `${target.comment} ${text}` : text;
      }
      i += comment[0].length;
      continue;
    }
    const ending = /^N(\d)/.exec(rest);
    if (ending) {
      if (+ending[1] > 0) cur.ending = +ending[1];
      i += 2;
      continue;
    }
    if (ch === "(") {
      // Alternate chords drawn small above the bar; not played.
      const end = music.indexOf(")", i);
      i = end < 0 ? music.length : end + 1;
      continue;
    }

    switch (ch) {
      case "{":
        close();
        cur.repeatStart = true;
        i++;
        continue;
      case "}":
        cur.repeatEnd = true;
        if (cur.chords.length === 0 && bars.length > 0) {
          bars[bars.length - 1].repeatEnd = true;
          delete cur.repeatEnd;
        }
        close();
        i++;
        continue;
      case "Z":
        if (cur.chords.length === 0 && bars.length > 0) bars[bars.length - 1].finalBar = true;
        else cur.finalBar = true;
        close();
        i++;
        continue;
      case "|":
      case "[":
      case "]":
        close();
        i++;
        continue;
      case "S":
        cur.segno = true;
        i++;
        continue;
      case "Q":
        if (cur.chords.length === 0 && bars.length > 0 && !cur.section) bars[bars.length - 1].coda = true;
        else cur.coda = true;
        i++;
        continue;
      case "x":
        cur.chords.push("%");
        i++;
        continue;
      case "r": {
        // Repeat the previous two bars.
        const a = bars[bars.length - 2];
        const b = bars[bars.length - 1];
        if (a && b) {
          cur.chords = [...a.chords];
          close();
          cur.chords = [...b.chords];
          close();
        }
        i++;
        continue;
      }
      case "n":
        cur.chords.push("NC");
        i++;
        continue;
      case "p":
        cur.chords.push("/");
        i++;
        continue;
    }

    const chord = CHORD_RE.exec(rest);
    if (chord && chord[0].length > 0) {
      let [, root, quality = "", bass = ""] = chord;
      if (root === "W") {
        // Invisible root: same chord as before, new bass note.
        cur.chords.push(lastChord ? lastChord.replace(/\/.*$/, "") + bass : "/");
      } else {
        quality = quality.replace(/^\^(?=$|7|9|13)/, "maj").replace(/^majmaj/, "maj");
        if (quality === "maj") quality = "maj7";
        lastChord = root + quality + bass;
        cur.chords.push(lastChord);
      }
      i += chord[0].length;
      continue;
    }

    // Spaces, commas, fermatas, spacers and size markers carry no musical meaning here.
    i++;
  }
  close();
  return { bars, timeSig: firstTimeSig || "4/4" };
}
