// The band styles on offer. The arranger decides what each style actually plays.

export interface StyleInfo {
  tempo: number;
  /** Where the off-beat eighth lands, as a fraction of the beat: 0.5 is straight, ~0.66 is a triplet swing. */
  swing: number;
  /** Comping uses rootless jazz voicings rather than plain triads and sevenths. */
  jazzVoicings: boolean;
}

export const STYLES: Record<string, StyleInfo> = {
  "Medium Swing": { tempo: 140, swing: 0.64, jazzVoicings: true },
  "Up Tempo Swing": { tempo: 240, swing: 0.58, jazzVoicings: true },
  Ballad: { tempo: 66, swing: 0.62, jazzVoicings: true },
  "Jazz Waltz": { tempo: 150, swing: 0.62, jazzVoicings: true },
  "Bossa Nova": { tempo: 130, swing: 0.5, jazzVoicings: true },
  "Even 8ths": { tempo: 100, swing: 0.5, jazzVoicings: false },
  Rock: { tempo: 120, swing: 0.5, jazzVoicings: false },
  Funk: { tempo: 98, swing: 0.5, jazzVoicings: true },
};

export const STYLE_NAMES = Object.keys(STYLES);

/** Picks the nearest of our styles for an iReal Pro style name. */
export function styleForIRealName(name: string): string {
  const n = name.toLowerCase();
  if (STYLES[name]) return name;
  if (/waltz/.test(n)) return "Jazz Waltz";
  if (/ballad|slow/.test(n)) return "Ballad";
  if (/up tempo|uptempo|bebop|fast/.test(n)) return "Up Tempo Swing";
  if (/bossa|latin|samba|cha|rhumba|bolero|calypso|afro|salsa|brazil|tango/.test(n)) return "Bossa Nova";
  if (/funk|soul|r&b|hip hop|disco/.test(n)) return "Funk";
  if (/rock|punk|metal|country/.test(n)) return "Rock";
  if (/even|pop|folk|8th/.test(n)) return "Even 8ths";
  return "Medium Swing";
}
