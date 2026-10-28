# Band Assembler

A practice band in the browser, in the spirit of iReal Pro. Write a chord chart, pick a style, and a synthesised
piano, bass and drums play it back in any key and at any tempo.

Nothing is saved in the browser. Everything you want to keep is a download, and you open it again from the file.

## Features

- **Chart editor:** a four-bars-per-line grid. Each bar can have a section label, repeat signs, 1st/2nd/3rd endings,
  time signature changes, segno, coda, a final bar and a comment.
- **Chord entry:** `Cmaj7`, `C^7`, `CΔ`, `D-7`, `Dm7`, `Bø`, `Bh7`, `C°7`, `G7b9`, `G7alt`, `F/A` and similar spellings.
  `/` holds the previous chord for another beat, `%` repeats the previous bar and `NC` means no chord.
- **Playback:** follows the form, including repeats, endings, D.C./D.S. al Coda and al Fine. The current bar is
  highlighted, there is an optional count-in, and the band ends on a closing chord.
- **Styles:** Medium Swing, Up Tempo Swing, Ballad, Jazz Waltz, Bossa Nova, Even 8ths, Rock and Funk. The piano uses
  voice-led rootless voicings, the bass walks with approach notes, and the drums play fills into new sections.
- **Practice tools:** transpose to any key, 1 to 8 choruses or loop forever, an automatic tempo increase after each
  chorus, and a mixer with a level and mute for each instrument.
- **Files:**
  - **Download chart** saves the current chart as `Title.band.json`.
  - **Download all** saves every open chart in a single file.
  - **Download audio** renders the backing track to a WAV file.
  - **Print** prints the chart or saves it as a PDF.
  - **Open…** (or drag and drop) loads `.band.json` files and iReal Pro playlist exports (`.html`).
  - **Import iReal** reads a pasted `irealb://` link.

The chart file is plain JSON:

```json
{
  "format": "band-assembler",
  "version": 1,
  "songs": [
    {
      "title": "Blues in F", "composer": "", "style": "Medium Swing", "key": "F",
      "transpose": 0, "tempo": 140, "timeSig": "4/4",
      "bars": [{ "chords": ["F7"], "section": "A" }, { "chords": ["Bb7"] }]
    }
  ]
}
```

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play / stop |
| Arrow keys | Move around the chart |
| A–G | Start typing a chord into the selected bar |
| Enter / Tab | Next bar (Shift+Tab goes back) |
| Delete | Clear the bar |
| Esc | Leave the chord box |

## Development

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static site in dist/
```

The app is a static site with no runtime dependencies or server. Pushing to `main` deploys it to GitHub Pages. To turn
this on, go to the repository's **Settings → Pages** and set **Source** to **GitHub Actions**.

### Layout

| File | Contents |
| --- | --- |
| `src/theory.ts` | Note names, chord parsing, transposition |
| `src/song.ts` | Chart model, playback order (repeats, endings, D.C./D.S.), file format |
| `src/ireal.ts` | iReal Pro link decoding |
| `src/styles.ts` | Style list |
| `src/arranger.ts` | Voicings, comping, bass lines and drum grooves |
| `src/performance.ts` | Walks a chart bar by bar for the arranger |
| `src/synth.ts` | Web Audio instruments and mixer |
| `src/player.ts` | Live scheduler and WAV rendering |
| `src/main.ts` | User interface |

iReal Pro is a trademark of its owners. This project is not affiliated with it, and it ships no songs from the iReal
Pro library.
