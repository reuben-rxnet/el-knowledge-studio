// Generates Studio's built-in background music with FFmpeg's own tone generators: no samples and no
// third-party recordings, so the tracks carry no licence terms. Run once; the results are committed:
//   node scripts/make-music.mjs
// Each track is a 64-second loop of soft chord pads (plus a light arpeggio for "bright" and "focus").
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import ffmpeg from "ffmpeg-static";

const OUT = path.join(process.cwd(), "public", "studio", "music");
mkdirSync(OUT, { recursive: true });
const SEC = 64, CHORD = 4;
const hz = (n) => 440 * 2 ** ((n - 69) / 12); // MIDI note -> Hz

/** Chords as MIDI notes; each lasts CHORD seconds and the progression repeats. */
const TRACKS = {
  calm: { chords: [[48, 55, 64, 67], [45, 52, 60, 64], [41, 48, 57, 60], [43, 50, 59, 62]], pad: 0.09, arp: null },
  bright: { chords: [[50, 57, 66, 69], [47, 54, 62, 66], [43, 50, 59, 62], [45, 52, 61, 64]], pad: 0.07, arp: { every: 0.25, gain: 0.05 } },
  focus: { chords: [[45, 52, 60, 64], [41, 48, 57, 60], [48, 55, 64, 67], [43, 50, 59, 62]], pad: 0.08, arp: { every: 0.5, gain: 0.045 } },
};

for (const [name, t] of Object.entries(TRACKS)) {
  const parts = [], labels = [];
  const n = SEC / CHORD;
  for (let k = 0; k < n; k++) {
    const notes = t.chords[k % t.chords.length];
    // A soft pad: each note plus a slightly detuned copy, faded in and out so chords overlap smoothly.
    const pad = notes.map((m) => `sin(2*PI*${hz(m).toFixed(3)}*t)+0.5*sin(2*PI*${(hz(m) * 1.003).toFixed(3)}*t)`).join("+");
    let expr = `${t.pad}*(${pad})`;
    if (t.arp) {
      // Plucked arpeggio over the chord's upper notes: a sine with a fast decay on every step.
      const up = notes.slice(1).map((m) => hz(m + 12));
      const steps = Math.round(CHORD / t.arp.every);
      const sel = up.map((f, i) => `eq(mod(floor(t/${t.arp.every}),${up.length}),${i})*sin(2*PI*${f.toFixed(3)}*t)`).join("+");
      expr += `+${t.arp.gain}*(${sel})*exp(-7*mod(t,${t.arp.every}))*lt(t,${(steps * t.arp.every).toFixed(2)})`;
    }
    parts.push(`aevalsrc='${expr}':s=48000:d=${CHORD + 1},afade=t=in:d=1.2,afade=t=out:st=${CHORD - 0.2}:d=1.2,adelay=${k * CHORD * 1000}|${k * CHORD * 1000}[c${k}]`);
    labels.push(`[c${k}]`);
  }
  const graph = `${parts.join(";")};${labels.join("")}amix=inputs=${n}:normalize=0,lowpass=f=2600,aecho=0.8:0.6:70|140:0.22|0.12,atrim=0:${SEC},afade=t=in:d=1.5,afade=t=out:st=${SEC - 2}:d=2,pan=stereo|c0=c0|c1=c0,loudnorm=I=-20:TP=-2[out]`;
  const file = path.join(OUT, `${name}.m4a`);
  execFileSync(ffmpeg, ["-y", "-hide_banner", "-loglevel", "error", "-filter_complex", graph, "-map", "[out]", "-c:a", "aac", "-b:a", "96k", "-ar", "48000", file]);
  console.log("wrote", file);
}
