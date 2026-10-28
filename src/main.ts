import "./style.css";
import { exampleSongs } from "./examples";
import { findIRealLinks, parseIRealLink } from "./ireal";
import { Player, renderWav } from "./player";
import { barTimeSigs, Bar, fromFile, newSong, Song, toFile } from "./song";
import { STYLE_NAMES, STYLES } from "./styles";
import { defaultMix, Group, GROUPS } from "./synth";
import {
  displayParts, keyName, keyPrefersFlats, MAJOR_KEYS, MINOR_KEYS, mod12, parseChord, parseKey, transposeKey, transposeSymbol,
} from "./theory";

const TIME_SIGS = ["4/4", "3/4", "2/4", "5/4", "6/4", "6/8", "7/8", "12/8", "2/2"];
const BARS_PER_ROW = 4;

// ---- State -----------------------------------------------------------------

const songs: Song[] = exampleSongs();
const dirty = new Set<Song>();
let current = 0;
let selected = 0;
let playingBar = -1;

const mix = defaultMix();
const live = { song: songs[0], choruses: 3, tempoStep: 0, countIn: true };
const player = new Player(live, mix);

const song = () => songs[current];

// ---- DOM -------------------------------------------------------------------

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  songList: $("song-list"),
  title: $<HTMLInputElement>("title"),
  composer: $<HTMLInputElement>("composer"),
  style: $<HTMLSelectElement>("style"),
  key: $<HTMLSelectElement>("key"),
  timesig: $<HTMLSelectElement>("timesig"),
  tempoNum: $<HTMLInputElement>("tempo-num"),
  chart: $("chart"),
  barLabel: $("bar-label"),
  barChords: $<HTMLInputElement>("bar-chords"),
  barSection: $<HTMLInputElement>("bar-section"),
  barRepeatStart: $<HTMLInputElement>("bar-repeat-start"),
  barRepeatEnd: $<HTMLInputElement>("bar-repeat-end"),
  barEnding: $<HTMLSelectElement>("bar-ending"),
  barTimesig: $<HTMLSelectElement>("bar-timesig"),
  barSegno: $<HTMLInputElement>("bar-segno"),
  barCoda: $<HTMLInputElement>("bar-coda"),
  barFinal: $<HTMLInputElement>("bar-final"),
  barComment: $<HTMLInputElement>("bar-comment"),
  play: $<HTMLButtonElement>("btn-play"),
  tempo: $<HTMLInputElement>("tempo"),
  tempoOut: $<HTMLOutputElement>("tempo-out"),
  transpose: $<HTMLSelectElement>("transpose"),
  choruses: $<HTMLSelectElement>("choruses"),
  tempoStep: $<HTMLSelectElement>("tempo-step"),
  countIn: $<HTMLInputElement>("count-in"),
  mixer: $("mixer"),
  fileInput: $<HTMLInputElement>("file-input"),
  importDialog: $<HTMLDialogElement>("import-dialog"),
  importText: $<HTMLTextAreaElement>("import-text"),
  importError: $("import-error"),
  toast: $("toast"),
};

function options(select: HTMLSelectElement, items: Array<[string, string]>): void {
  select.innerHTML = items.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join("");
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

options(el.style, STYLE_NAMES.map((s) => [s, s]));
options(el.key, [...MAJOR_KEYS, ...MINOR_KEYS].map((k) => [k, prettyKey(k)]));
options(el.timesig, TIME_SIGS.map((t) => [t, t]));
options(el.barTimesig, [["", "–"], ...TIME_SIGS.map((t): [string, string] => [t, t])]);

function prettyKey(k: string): string {
  return k.replace("b", "♭").replace("#", "♯").replace(/-$/, " minor");
}

// ---- Transposition helpers --------------------------------------------------

function soundingFlats(s: Song): boolean {
  return keyPrefersFlats(transposeKey(parseKey(s.key), s.transpose));
}

function shown(symbol: string, s = song()): string {
  return transposeSymbol(symbol, s.transpose, soundingFlats(s));
}

function stored(symbol: string, s = song()): string {
  return transposeSymbol(symbol, -s.transpose, keyPrefersFlats(parseKey(s.key)));
}

function isSpecial(token: string): boolean {
  return token === "/" || token === "%" || /^n\.?c\.?$/i.test(token);
}

// ---- Rendering -------------------------------------------------------------

function renderAll(): void {
  renderSongList();
  renderMeta();
  renderChart();
  renderBarEditor();
  renderTransport();
}

function renderSongList(): void {
  el.songList.innerHTML = songs
    .map((s, i) => {
      const key = prettyKey(keyName(transposeKey(parseKey(s.key), s.transpose)));
      return `<li class="${i === current ? "active" : ""}">
        <button class="song-pick" data-song="${i}">
          <span class="song-title">${esc(s.title || "Untitled")}${dirty.has(s) ? ' <span class="dot" title="Not downloaded since the last change">●</span>' : ""}</span>
          <span class="song-sub">${esc(s.style)} · ${esc(key)}</span>
        </button>
        <button class="song-close" data-close="${i}" aria-label="Close ${esc(s.title)}">×</button>
      </li>`;
    })
    .join("");
}

function renderMeta(): void {
  const s = song();
  el.title.value = s.title;
  el.composer.value = s.composer;
  el.style.value = STYLES[s.style] ? s.style : "Medium Swing";
  const k = parseKey(s.key);
  el.key.value = keyName(k);
  el.timesig.value = s.timeSig;
  el.tempoNum.value = String(s.tempo);
  document.title = `${s.title || "Untitled"} · Band Assembler`;
}

function chordHtml(token: string): string {
  if (token === "%") return `<span class="chord repeat-bar" title="Repeat previous bar">%</span>`;
  if (token === "/") return `<span class="chord hold">/</span>`;
  if (/^n\.?c\.?$/i.test(token)) return `<span class="chord nc">N.C.</span>`;
  const sym = shown(token);
  const ok = parseChord(sym) !== null;
  const p = displayParts(sym);
  return `<span class="chord${ok ? "" : " bad"}" title="${ok ? "" : "Not a chord I can play"}">${esc(p.root)}<sup>${esc(p.quality)}</sup>${
    p.bass ? `<span class="bass">/${esc(p.bass)}</span>` : ""
  }</span>`;
}

function renderChart(): void {
  const s = song();
  const sigs = barTimeSigs(s);
  const cells = s.bars.map((bar, i) => {
    const cls = ["bar"];
    if (i === selected) cls.push("selected");
    if (i === playingBar) cls.push("playing");
    if (bar.repeatStart) cls.push("repeat-start");
    if (bar.repeatEnd) cls.push("repeat-end");
    if (bar.finalBar) cls.push("final");
    if (bar.section) cls.push("has-section");
    const showSig = i === 0 || (bar.timeSig && bar.timeSig !== sigs[i - 1]);
    if (showSig) cls.push("has-sig");
    const top = [
      bar.section ? `<span class="section">${esc(bar.section)}</span>` : "",
      showSig ? `<span class="timesig">${esc(sigs[i]).replace("/", "<br>")}</span>` : "",
      bar.segno ? `<span class="sign" title="Segno">𝄋</span>` : "",
      bar.coda ? `<span class="sign" title="Coda">𝄌</span>` : "",
      bar.comment ? `<span class="comment">${esc(bar.comment)}</span>` : "",
    ].join("");
    const chords = bar.chords.length ? bar.chords.map(chordHtml).join("") : `<span class="empty">·</span>`;
    return `<div class="${cls.join(" ")}" data-bar="${i}" role="button" aria-label="Bar ${i + 1}">
      ${bar.ending ? `<span class="ending">${bar.ending}.</span>` : ""}
      <div class="bar-top">${top}</div>
      <div class="bar-chords n${Math.min(bar.chords.length, 4)}">${chords}</div>
    </div>`;
  });
  el.chart.innerHTML = cells.join("");
  el.chart.style.setProperty("--cols", String(BARS_PER_ROW));
}

function renderBarEditor(): void {
  const s = song();
  const bar = s.bars[selected];
  if (!bar) return;
  el.barLabel.textContent = `Bar ${selected + 1} of ${s.bars.length}`;
  if (document.activeElement !== el.barChords) el.barChords.value = bar.chords.map((c) => (isSpecial(c) ? c : shown(c))).join(" ");
  el.barSection.value = bar.section ?? "";
  el.barRepeatStart.checked = !!bar.repeatStart;
  el.barRepeatEnd.checked = !!bar.repeatEnd;
  el.barEnding.value = bar.ending ? String(bar.ending) : "";
  el.barTimesig.value = bar.timeSig ?? "";
  el.barSegno.checked = !!bar.segno;
  el.barCoda.checked = !!bar.coda;
  el.barFinal.checked = !!bar.finalBar;
  el.barComment.value = bar.comment ?? "";
}

function renderTransport(): void {
  const s = song();
  el.tempo.value = String(s.tempo);
  el.tempoOut.value = String(s.tempo);
  const written = parseKey(s.key);
  const keys = written.minor ? MINOR_KEYS : MAJOR_KEYS;
  options(
    el.transpose,
    keys.map((k, pc) => {
      let shift = mod12(pc - written.tonic);
      if (shift > 6) shift -= 12;
      return [String(shift), prettyKey(k) + (shift === 0 ? " (written)" : "")];
    }),
  );
  el.transpose.value = String(s.transpose > 6 ? s.transpose - 12 : s.transpose);
  el.play.textContent = player.playing ? "■" : "▶";
  el.play.setAttribute("aria-label", player.playing ? "Stop" : "Play");
  el.play.classList.toggle("on", player.playing);
}

function renderMixer(): void {
  el.mixer.innerHTML = GROUPS.map(
    (g) => `<div class="channel">
      <button class="mute${mix.muted[g] ? " on" : ""}" data-mute="${g}" aria-pressed="${mix.muted[g]}" title="Mute ${g}">${g}</button>
      <input type="range" min="0" max="1" step="0.01" value="${mix[g]}" data-level="${g}" aria-label="${g} volume" />
    </div>`,
  ).join("");
}

// ---- Editing ---------------------------------------------------------------

function changed(full = false): void {
  dirty.add(song());
  if (full) renderAll();
  else {
    renderChart();
    renderSongList();
  }
}

function select(i: number, focusInput = false): void {
  const s = song();
  selected = Math.max(0, Math.min(s.bars.length - 1, i));
  renderChart();
  el.barChords.value = "";
  el.barChords.blur();
  renderBarEditor();
  el.chart.querySelector(`[data-bar="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  if (focusInput) {
    el.barChords.focus();
    el.barChords.select();
  }
}

function currentBar(): Bar {
  return song().bars[selected];
}

el.barChords.addEventListener("input", () => {
  const tokens = el.barChords.value.trim().split(/[\s,|]+/).filter(Boolean);
  currentBar().chords = tokens.map((t) => (isSpecial(t) ? t.toUpperCase().replace("N.C.", "NC") : stored(normaliseTyped(t))));
  changed();
});

/** Lets people type "bb7" or "f#m7" without fussing over capital letters. */
function normaliseTyped(token: string): string {
  return token.replace(/^([a-g])/, (c) => c.toUpperCase());
}

el.barChords.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    nextBar();
  } else if (e.key === "Escape") {
    el.barChords.blur();
    el.chart.focus();
  } else if (e.key === "Tab" && !e.shiftKey && el.barChords.selectionStart === el.barChords.value.length) {
    e.preventDefault();
    nextBar();
  } else if (e.key === "Tab" && e.shiftKey) {
    e.preventDefault();
    select(selected - 1, true);
  }
});

function nextBar(): void {
  if (selected === song().bars.length - 1) {
    song().bars.push({ chords: [] });
    changed();
  }
  select(selected + 1, true);
}

$("bar-next").addEventListener("click", nextBar);

function barField(input: HTMLInputElement | HTMLSelectElement, apply: (bar: Bar, value: string, checked: boolean) => void): void {
  input.addEventListener(input instanceof HTMLInputElement && input.type !== "checkbox" ? "input" : "change", () => {
    const bar = currentBar();
    apply(bar, input.value, input instanceof HTMLInputElement && input.checked);
    for (const k of Object.keys(bar) as Array<keyof Bar>) {
      if (k !== "chords" && (bar[k] === "" || bar[k] === false || bar[k] === undefined)) delete bar[k];
    }
    changed();
  });
}

barField(el.barSection, (b, v) => (b.section = v.trim()));
barField(el.barRepeatStart, (b, _v, c) => (b.repeatStart = c));
barField(el.barRepeatEnd, (b, _v, c) => (b.repeatEnd = c));
barField(el.barEnding, (b, v) => (b.ending = v ? Number(v) : undefined));
barField(el.barTimesig, (b, v) => (b.timeSig = v || undefined));
barField(el.barSegno, (b, _v, c) => (b.segno = c));
barField(el.barCoda, (b, _v, c) => (b.coda = c));
barField(el.barFinal, (b, _v, c) => (b.finalBar = c));
barField(el.barComment, (b, v) => (b.comment = v));

$("bar-insert-before").addEventListener("click", () => {
  song().bars.splice(selected, 0, { chords: [] });
  changed();
  select(selected, true);
});
$("bar-insert-after").addEventListener("click", () => {
  song().bars.splice(selected + 1, 0, { chords: [] });
  changed();
  select(selected + 1, true);
});
$("bar-duplicate").addEventListener("click", () => {
  song().bars.splice(selected + 1, 0, structuredClone(currentBar()));
  changed();
  select(selected + 1);
});
$("bar-delete").addEventListener("click", () => {
  const bars = song().bars;
  if (bars.length === 1) bars[0] = { chords: [] };
  else bars.splice(selected, 1);
  changed();
  select(Math.min(selected, bars.length - 1));
});
$("bar-add-line").addEventListener("click", () => {
  const bars = song().bars;
  for (let k = 0; k < BARS_PER_ROW; k++) bars.push({ chords: [] });
  changed();
  select(bars.length - BARS_PER_ROW, true);
});

el.chart.addEventListener("click", (e) => {
  const barEl = (e.target as HTMLElement).closest<HTMLElement>("[data-bar]");
  if (barEl) select(Number(barEl.dataset.bar), true);
});

el.chart.addEventListener("keydown", (e) => {
  const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -BARS_PER_ROW, ArrowDown: BARS_PER_ROW };
  if (moves[e.key] !== undefined) {
    e.preventDefault();
    select(selected + moves[e.key]);
  } else if (e.key === "Enter") {
    e.preventDefault();
    select(selected, true);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    currentBar().chords = [];
    changed();
    renderBarEditor();
  } else if (/^[a-gA-G%/]$/.test(e.key) && !e.metaKey && !e.ctrlKey) {
    // Start typing a chord straight away.
    e.preventDefault();
    el.barChords.focus();
    el.barChords.value = e.key.toUpperCase();
    el.barChords.dispatchEvent(new Event("input"));
  }
});

el.title.addEventListener("input", () => {
  song().title = el.title.value;
  changed();
  document.title = `${song().title || "Untitled"} · Band Assembler`;
});
el.composer.addEventListener("input", () => {
  song().composer = el.composer.value;
  changed();
});
el.style.addEventListener("change", () => {
  song().style = el.style.value;
  changed(true);
});
el.key.addEventListener("change", () => {
  // Changing the written key rewrites the chart in the new key.
  const s = song();
  const from = parseKey(s.key);
  const to = parseKey(el.key.value);
  let shift = mod12(to.tonic - from.tonic);
  if (shift > 6) shift -= 12;
  const flats = keyPrefersFlats(to);
  s.bars.forEach((bar) => (bar.chords = bar.chords.map((c) => (isSpecial(c) ? c : transposeSymbol(c, shift, flats)))));
  s.key = el.key.value;
  if (from.minor !== to.minor) s.transpose = 0;
  changed(true);
});
el.timesig.addEventListener("change", () => {
  song().timeSig = el.timesig.value;
  changed();
});

function setTempo(value: number): void {
  const t = Math.max(30, Math.min(360, Math.round(value) || 120));
  song().tempo = t;
  el.tempo.value = el.tempoNum.value = el.tempoOut.value = String(t);
  dirty.add(song());
  renderSongList();
}
el.tempo.addEventListener("input", () => setTempo(Number(el.tempo.value)));
el.tempoNum.addEventListener("change", () => setTempo(Number(el.tempoNum.value)));

el.transpose.addEventListener("change", () => {
  song().transpose = Number(el.transpose.value);
  dirty.add(song());
  renderChart();
  renderBarEditor();
  renderSongList();
});
el.choruses.addEventListener("change", () => (live.choruses = Number(el.choruses.value)));
el.tempoStep.addEventListener("change", () => (live.tempoStep = Number(el.tempoStep.value)));
el.countIn.addEventListener("change", () => (live.countIn = el.countIn.checked));

el.mixer.addEventListener("input", (e) => {
  const t = e.target as HTMLInputElement;
  const g = t.dataset.level as Group | undefined;
  if (!g) return;
  mix[g] = Number(t.value);
  player.setMix(mix);
});
el.mixer.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-mute]");
  if (!t) return;
  const g = t.dataset.mute as Group;
  mix.muted[g] = !mix.muted[g];
  player.setMix(mix);
  renderMixer();
});

// ---- Songs -----------------------------------------------------------------

function openSong(i: number): void {
  if (player.playing) player.stop();
  current = Math.max(0, Math.min(songs.length - 1, i));
  selected = 0;
  live.song = song();
  renderAll();
}

el.songList.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const pickBtn = t.closest<HTMLElement>("[data-song]");
  const closeBtn = t.closest<HTMLElement>("[data-close]");
  if (closeBtn) {
    const i = Number(closeBtn.dataset.close);
    const s = songs[i];
    if (dirty.has(s) && !confirm(`“${s.title}” has changes you haven't downloaded. Close it anyway?`)) return;
    songs.splice(i, 1);
    dirty.delete(s);
    if (songs.length === 0) songs.push(newSong());
    openSong(i < current ? current - 1 : Math.min(current, songs.length - 1));
  } else if (pickBtn) {
    openSong(Number(pickBtn.dataset.song));
  }
});

function addSongs(list: Song[]): void {
  if (!list.length) return;
  songs.push(...list);
  openSong(songs.length - list.length);
}

$("btn-new").addEventListener("click", () => {
  const s = newSong();
  songs.push(s);
  dirty.add(s);
  openSong(songs.length - 1);
  el.title.focus();
  el.title.select();
});

// ---- Files -----------------------------------------------------------------

function slug(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "").trim() || "Untitled";
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

$("btn-save").addEventListener("click", () => {
  const s = song();
  download(new Blob([toFile([s])], { type: "application/json" }), `${slug(s.title)}.band.json`);
  dirty.delete(s);
  renderSongList();
});

$("btn-save-all").addEventListener("click", () => {
  download(new Blob([toFile(songs)], { type: "application/json" }), `Band Assembler charts (${songs.length}).band.json`);
  dirty.clear();
  renderSongList();
});

$("btn-wav").addEventListener("click", async (e) => {
  const button = e.currentTarget as HTMLButtonElement;
  const s = song();
  const choruses = live.choruses || 3;
  button.disabled = true;
  toast(`Rendering ${choruses} chorus${choruses === 1 ? "" : "es"}…`, 0);
  try {
    // Let the toast paint before the render takes over.
    await new Promise((r) => setTimeout(r, 30));
    const wav = await renderWav({ ...live, song: s, choruses }, mix);
    const key = keyName(transposeKey(parseKey(s.key), s.transpose)).replace("-", "m");
    download(wav, `${slug(s.title)} - ${s.style} ${key} ${s.tempo}bpm.wav`);
    toast("Audio downloaded.");
  } catch (err) {
    toast(`Could not render audio: ${(err as Error).message}`);
  } finally {
    button.disabled = false;
  }
});

$("btn-print").addEventListener("click", () => window.print());

$("btn-open").addEventListener("click", () => el.fileInput.click());

el.fileInput.addEventListener("change", async () => {
  const files = [...(el.fileInput.files ?? [])];
  el.fileInput.value = "";
  const opened: Song[] = [];
  const problems: string[] = [];
  for (const file of files) {
    const text = await file.text();
    try {
      opened.push(...readAnyChartText(text));
    } catch (err) {
      problems.push(`${file.name}: ${(err as Error).message}`);
    }
  }
  addSongs(opened);
  if (problems.length) toast(problems.join("\n"), 6000);
  else if (opened.length) toast(`Opened ${opened.length} chart${opened.length === 1 ? "" : "s"}.`);
});

/** Accepts our own files and anything containing iReal Pro links. */
function readAnyChartText(text: string): Song[] {
  if (text.trim().startsWith("{")) return fromFile(text);
  const links = findIRealLinks(text);
  if (!links.length) throw new Error("No charts found in this file.");
  const list = links.flatMap(parseIRealLink);
  if (!list.length) throw new Error("The iReal Pro link could not be read.");
  return list;
}

$("btn-import").addEventListener("click", () => {
  el.importError.textContent = "";
  el.importText.value = "";
  el.importDialog.showModal();
  el.importText.focus();
});

$("import-go").addEventListener("click", (e) => {
  e.preventDefault();
  try {
    const list = readAnyChartText(el.importText.value);
    el.importDialog.close();
    list.forEach((s) => dirty.add(s));
    addSongs(list);
    toast(`Imported ${list.length} chart${list.length === 1 ? "" : "s"}.`);
  } catch (err) {
    el.importError.textContent = (err as Error).message;
  }
});

// Dropping files anywhere opens them.
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files ?? [])];
  const list: Song[] = [];
  for (const f of files) {
    try {
      list.push(...readAnyChartText(await f.text()));
    } catch (err) {
      toast(`${f.name}: ${(err as Error).message}`);
    }
  }
  addSongs(list);
});

window.addEventListener("beforeunload", (e) => {
  if (dirty.size) e.preventDefault();
});

// ---- Playback --------------------------------------------------------------

el.play.addEventListener("click", async () => {
  if (player.playing) player.stop();
  else {
    live.song = song();
    await player.start();
  }
  renderTransport();
});

$("btn-more").addEventListener("click", (e) => {
  const open = document.querySelector(".transport")!.classList.toggle("open");
  (e.currentTarget as HTMLElement).setAttribute("aria-expanded", String(open));
});

document.addEventListener("keydown", (e) => {
  const typing = (e.target as HTMLElement).closest("input, textarea, select, button, [contenteditable]");
  if (e.code === "Space" && !typing) {
    e.preventDefault();
    el.play.click();
  }
});

player.onPosition = (pos) => {
  const index = pos && pos.chartIndex >= 0 ? pos.chartIndex : -1;
  if (index === playingBar && pos) return;
  el.chart.querySelector(".bar.playing")?.classList.remove("playing");
  playingBar = index;
  if (index >= 0) {
    const barEl = el.chart.querySelector(`[data-bar="${index}"]`);
    barEl?.classList.add("playing");
    barEl?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  if (!pos) renderTransport();
};

// ---- Toast -----------------------------------------------------------------

let toastTimer = 0;
function toast(message: string, ms = 3000): void {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  window.clearTimeout(toastTimer);
  if (ms > 0) toastTimer = window.setTimeout(() => el.toast.classList.remove("show"), ms);
}

renderMixer();
renderAll();
