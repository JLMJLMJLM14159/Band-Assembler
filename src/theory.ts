// Note names, chord-symbol parsing and transposition.

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Keys offered in the key pickers, in the order musicians usually expect. */
export const MAJOR_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const MINOR_KEYS = ["C-", "C#-", "D-", "Eb-", "E-", "F-", "F#-", "G-", "G#-", "A-", "Bb-", "B-"];

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Pitch class of a note name such as "Bb" or "F#"; null if it is not one. */
export function noteToPc(name: string): number | null {
  const m = /^([A-Ga-g])([b#]*)$/.exec(name.trim());
  if (!m) return null;
  let pc = LETTER_PC[m[1].toUpperCase()];
  for (const ch of m[2]) pc += ch === "#" ? 1 : -1;
  return mod12(pc);
}

export interface Key {
  tonic: number;
  minor: boolean;
}

/** Parses keys written as "Eb", "C-", "Cm" or "F#min". */
export function parseKey(text: string): Key {
  const m = /^\s*([A-Ga-g][b#]?)\s*(-|m|min|minor)?\s*$/.exec(text);
  if (!m) return { tonic: 0, minor: false };
  return { tonic: noteToPc(m[1]) ?? 0, minor: !!m[2] };
}

export function keyName(key: Key): string {
  const names = key.minor ? MINOR_KEYS : MAJOR_KEYS;
  return names[key.tonic];
}

export function transposeKey(key: Key, semitones: number): Key {
  return { tonic: mod12(key.tonic + semitones), minor: key.minor };
}

/** Whether a key is normally written with flats. */
export function keyPrefersFlats(key: Key): boolean {
  // Relative major decides the spelling of a minor key.
  const major = key.minor ? mod12(key.tonic + 3) : key.tonic;
  return [5, 10, 3, 8, 1, 6].includes(major);
}

export function pcName(pc: number, flats: boolean): string {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

export interface Chord {
  root: number;
  bass: number | null;
  /** Quality exactly as written, e.g. "-7", "maj7", "7b9". */
  quality: string;
  /** Semitones above the root, sorted, including 0. */
  intervals: number[];
  /** The triad/seventh character, used by the arrangers. */
  family: "major" | "minor" | "dominant" | "halfdim" | "dim" | "aug" | "sus" | "power";
  /** Whether the chord has a seventh (or sixth standing in for one). */
  hasSeventh: boolean;
}

const chordCache = new Map<string, Chord | null>();

/** Parses a chord symbol. Accepts common spellings: Cmaj7, C^7, CΔ, C-7, Cm7, Cø, Ch7, C°7, C7alt, C/E. */
export function parseChord(symbol: string): Chord | null {
  if (chordCache.has(symbol)) return chordCache.get(symbol)!;
  const result = parseChordUncached(symbol);
  chordCache.set(symbol, result);
  return result;
}

function parseChordUncached(symbol: string): Chord | null {
  const m = /^([A-G])([b#]?)([^/]*)(?:\/([A-G][b#]?))?$/.exec(symbol.trim());
  if (!m) return null;
  const root = noteToPc(m[1] + m[2])!;
  const quality = m[3];
  const bass = m[4] ? noteToPc(m[4]) : null;
  const parsed = parseQuality(quality);
  if (!parsed) return null;
  return { root, bass, quality, ...parsed };
}

function parseQuality(raw: string): Omit<Chord, "root" | "bass" | "quality"> | null {
  let q = raw
    .replace(/\s+/g, "")
    .replace(/Δ|\^|M(?=7|9|11|13|$)|maj|Maj|MA/g, "maj")
    .replace(/ø|h/g, "m7b5")
    .replace(/°|o/g, "dim")
    .replace(/^(min|mi|-)/, "m")
    .replace(/\+/g, "aug")
    .replace(/[()]/g, "");

  const set = new Set<number>([0]);
  let family: Chord["family"] = "major";
  let hasSeventh = false;
  let third: number | null = 4;
  let fifth: number | null = 7;

  const take = (re: RegExp): RegExpExecArray | null => {
    const found = re.exec(q);
    if (found) q = q.slice(0, found.index) + q.slice(found.index + found[0].length);
    return found;
  };

  if (take(/^m7b5/)) {
    family = "halfdim";
    third = 3;
    fifth = 6;
    set.add(10);
    hasSeventh = true;
  } else if (take(/^dim/)) {
    family = "dim";
    third = 3;
    fifth = 6;
    if (take(/^7/)) {
      set.add(9);
      hasSeventh = true;
    }
  } else if (take(/^aug/)) {
    family = "aug";
    fifth = 8;
  } else if (/^m(?!aj)/.test(q)) {
    take(/^m/);
    family = "minor";
    third = 3;
  } else if (take(/^5$/)) {
    return { intervals: [0, 7], family: "power", hasSeventh: false };
  }

  // Sevenths and the extensions that imply them.
  const maj = take(/^maj(7|9|11|13)?/);
  if (maj) {
    set.add(11);
    hasSeventh = true;
    addExtension(set, maj[1]);
    if (family !== "minor" && family !== "aug") family = "major";
  } else {
    const ext = take(/^(7|9|11|13)/);
    if (ext) {
      if (family !== "dim") set.add(10);
      hasSeventh = true;
      addExtension(set, ext[1]);
      if (family === "major") family = "dominant";
    } else if (take(/^69/)) {
      set.add(9).add(14);
      hasSeventh = true;
    } else if (take(/^6/)) {
      set.add(9);
      hasSeventh = true;
    } else if (take(/^2/)) {
      set.add(14);
    }
  }

  if (take(/sus2/)) {
    third = null;
    set.add(2);
    if (family === "major" || family === "dominant") family = "sus";
  } else if (take(/sus4?/)) {
    third = null;
    set.add(5);
    if (family === "major" || family === "dominant") family = "sus";
  }

  if (take(/alt/)) {
    set.add(13).add(15).add(20);
    fifth = null;
    if (family === "major") family = "dominant";
    if (!set.has(10)) set.add(10);
    hasSeventh = true;
  }

  // Remaining alterations and additions, in any order.
  for (;;) {
    const alt = take(/^(add)?([b#]?)(5|9|11|13|2|3|4|6)/);
    if (!alt) break;
    const [, add, acc, num] = alt;
    const base: Record<string, number> = { "2": 2, "3": 4, "4": 5, "5": 7, "6": 9, "9": 14, "11": 17, "13": 21 };
    const shift = acc === "b" ? -1 : acc === "#" ? 1 : 0;
    if (num === "5" && !add) fifth = 7 + shift;
    else set.add(base[num] + shift);
  }

  // Anything we could not understand makes the symbol invalid.
  if (q.length > 0) return null;

  if (third !== null) set.add(third);
  if (fifth !== null) set.add(fifth);
  return { intervals: [...set].sort((a, b) => a - b), family, hasSeventh };
}

function addExtension(set: Set<number>, ext: string | undefined): void {
  if (!ext || ext === "7") return;
  set.add(14);
  if (ext === "11") set.add(17);
  if (ext === "13") set.add(21);
}

/** Transposes one chord symbol, keeping its quality text. Unknown tokens pass through. */
export function transposeSymbol(symbol: string, semitones: number, flats: boolean): string {
  if (semitones === 0) return symbol;
  const m = /^([A-G][b#]?)([^/]*)(?:\/([A-G][b#]?))?$/.exec(symbol);
  if (!m) return symbol;
  const root = noteToPc(m[1]);
  if (root === null) return symbol;
  let out = pcName(root + semitones, flats) + m[2];
  if (m[3]) {
    const bass = noteToPc(m[3]);
    if (bass !== null) out += "/" + pcName(bass + semitones, flats);
  }
  return out;
}

/** Splits a symbol into the pieces the chart draws: root, quality (prettified) and bass. */
export function displayParts(symbol: string): { root: string; quality: string; bass: string } {
  const m = /^([A-G])([b#]?)([^/]*)(?:\/([A-G][b#]?))?$/.exec(symbol);
  if (!m) return { root: symbol, quality: "", bass: "" };
  const acc = m[2] === "b" ? "♭" : m[2] === "#" ? "♯" : "";
  const quality = m[3]
    .replace(/maj7|\^7|M7|Δ7/g, "Δ7")
    .replace(/maj|\^/g, "Δ")
    .replace(/^m7b5|^h7?/, "ø")
    .replace(/^-|^min|^mi|^m(?!aj)/, "–")
    .replace(/dim|^o/, "°")
    .replace(/b(?=\d)/g, "♭")
    .replace(/#(?=\d)/g, "♯");
  const bass = m[4] ? m[4].replace("b", "♭").replace("#", "♯") : "";
  return { root: m[1] + acc, quality, bass };
}
