/**
 * All sound here is synthesised at runtime with the Web Audio API — there
 * are no audio files to download or decode. For a landing page that is
 * the right trade: a music loop and two SFX would outweigh the entire JS
 * bundle, and this way the music can actually respond to depth instead of
 * being a fixed recording.
 *
 * The ambience is MUSIC, not a water noise bed: a slow pad progression in
 * a minor pentatonic (a scale with no semitone clashes, so it stays calm
 * however the notes land), sparse bell notes over the top, and a
 * generated reverb to give it space. Depth transposes it down and closes
 * the filter, so descending darkens the harmony rather than just the
 * picture.
 *
 * Browsers refuse to start audio before a user gesture, so nothing is
 * created until `unlock()` runs from a real interaction.
 */

let ctx = null;
let master = null;
let musicBus = null;
let musicGain = null;
let toneFilter = null;
let reverbSend = null;
let started = false;
let muted = false;
let stopped = false;

let depthNorm = 0;
let chordTimer = null;
let bellTimer = null;

/* ------------------------------------------------------------- material */

const ROOT = 55; // A1
/** minor pentatonic — no semitones, so nothing can clash */
const SCALE = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24];

/** A slow, unhurried progression. Degrees into SCALE, not semitones. */
const PROGRESSION = [
  [0, 4, 7],
  [3, 7, 9],
  [2, 5, 9],
  [1, 4, 8],
];

const semi = (n) => ROOT * Math.pow(2, n / 12);

function noiseBuffer(seconds, brown = false) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      d[i] = w;
    }
  }
  return buf;
}

/** A generated impulse response: noise under an exponential decay. Cheap,
 *  no asset, and it's what makes this sound like a space rather than a
 *  synth plugged straight into the speakers. */
function makeReverbIR(seconds = 3.4, decay = 2.6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

/* ------------------------------------------------------------- lifecycle */

export function unlock() {
  if (stopped) return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    const convolver = ctx.createConvolver();
    convolver.buffer = makeReverbIR();
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    convolver.connect(wet);
    wet.connect(master);

    reverbSend = ctx.createGain();
    reverbSend.gain.value = 1;
    reverbSend.connect(convolver);

    // everything musical goes through one filter, so depth can close it
    toneFilter = ctx.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = 2400;
    toneFilter.Q.value = 0.4;

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.0;

    musicBus = ctx.createGain();
    musicBus.connect(toneFilter);
    toneFilter.connect(musicGain);
    musicGain.connect(master);
    musicGain.connect(reverbSend);
  }
  if (ctx.state === "suspended") ctx.resume();
  if (!started) {
    started = true;
    // fade the music in rather than starting at full level
    musicGain.gain.setTargetAtTime(0.34, ctx.currentTime, 2.5);
    scheduleChord(0);
    scheduleBell();
  }
  return ctx;
}

export function isReady() {
  return !!ctx && started;
}

export function setMuted(v) {
  muted = v;
  if (!master) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setTargetAtTime(v ? 0 : 0.9, ctx.currentTime, 0.2);
}

export function getMuted() {
  return muted;
}

/** Release everything — for hot reload / unmount. */
export function dispose() {
  stopped = true;
  clearTimeout(chordTimer);
  clearTimeout(bellTimer);
  if (ctx) ctx.close();
  ctx = null;
  started = false;
  stopped = false;
}

/* ------------------------------------------------------------------ pad */

/**
 * One chord: a few detuned voices per note with a long attack and an even
 * longer release, so chords overlap and never articulate a hard edge.
 */
function playChord(degrees, when, dur) {
  const transpose = -12 * depthNorm; // sinks by an octave at full depth
  degrees.forEach((deg, i) => {
    const n = SCALE[deg % SCALE.length] + 12 * Math.floor(deg / SCALE.length);
    const base = semi(n + 24 + transpose);

    // two slightly detuned voices per note = movement without chorus
    [-4, 4].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? "sine" : "triangle";
      o.frequency.value = base;
      o.detune.value = cents;

      const g = ctx.createGain();
      const peak = (i === 0 ? 0.16 : 0.1) / 2;
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(peak, when + 3.2);
      g.gain.setValueAtTime(peak, when + dur - 4.5);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);

      o.connect(g);
      g.connect(musicBus);
      o.start(when);
      o.stop(when + dur + 0.2);
    });
  });
}

let chordIndex = 0;
function scheduleChord() {
  if (!ctx || stopped) return;
  const dur = 15;
  playChord(PROGRESSION[chordIndex % PROGRESSION.length], ctx.currentTime + 0.05, dur);
  chordIndex++;
  // overlap: the next chord starts before this one has finished releasing
  chordTimer = setTimeout(scheduleChord, (dur - 4) * 1000);
}

/* ----------------------------------------------------------------- bells */

/** Sparse single notes over the pad. Soft attack, long tail, random pan. */
function playBell() {
  if (!ctx || stopped) return;
  const t = ctx.currentTime;
  const transpose = -12 * depthNorm;
  const deg = SCALE[Math.floor(Math.random() * SCALE.length)];
  const f = semi(deg + 36 + transpose);

  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.value = f;

  // a quiet octave above gives it a bell's shimmer without an FM stack
  const o2 = ctx.createOscillator();
  o2.type = "sine";
  o2.frequency.value = f * 2.01;

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09 * (0.6 + Math.random() * 0.4), t + 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.0001, t);
  g2.gain.exponentialRampToValueAtTime(0.02, t + 0.3);
  g2.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);

  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.2 - 0.6;

  o.connect(g);
  o2.connect(g2);
  g.connect(pan);
  g2.connect(pan);
  pan.connect(musicBus);
  o.start(t);
  o2.start(t);
  o.stop(t + 5);
  o2.stop(t + 3);
}

function scheduleBell() {
  if (!ctx || stopped) return;
  playBell();
  bellTimer = setTimeout(scheduleBell, 4000 + Math.random() * 7000);
}

/* ----------------------------------------------------------------- depth */

/** Depth darkens the music: transposed down, filtered, and wetter. */
export function setDepth(depth) {
  depthNorm = Math.min(1, Math.max(0, depth / 104));
  if (!ctx || !started) return;
  const t = ctx.currentTime;
  toneFilter.frequency.setTargetAtTime(2400 - 1750 * depthNorm, t, 1.2);
  reverbSend.gain.setTargetAtTime(0.8 + 0.9 * depthNorm, t, 1.2);
}

/* ----------------------------------------------------------------- click */

/**
 * A mechanical switch, in two halves: a bright contact transient (filtered
 * noise) and a low body thunk. The press is harder and brighter than the
 * release, which is what a real two-stage button does.
 */
export function playClick(down = true) {
  if (!unlock()) return;
  const t = ctx.currentTime;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = down ? 2700 : 1900;
  bp.Q.value = 1.3;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(down ? 0.4 : 0.22, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (down ? 0.05 : 0.04));
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + 0.1);

  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(down ? 175 : 140, t);
  o.frequency.exponentialRampToValueAtTime(68, t + 0.07);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(down ? 0.24 : 0.14, t + 0.006);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(og);
  og.connect(master);
  o.start(t);
  o.stop(t + 0.11);
}

export function playSwitch() {
  playClick(true);
  setTimeout(() => playClick(false), 105);
}

/* --------------------------------------------------------------- bubbles */

/**
 * A bubble is a sine whose pitch sweeps UP as it detaches — that rising
 * blip is the whole sound, and it's why a synthesised bubble beats a
 * sampled one. Sent to the reverb so it sits in the same space as the
 * music rather than on top of it.
 */
export function playBubble(vol = 1) {
  if (!ctx || !started) return;
  const t = ctx.currentTime;
  const f0 = 360 + Math.random() * 560;

  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(
    f0 * (1.7 + Math.random() * 1.0),
    t + 0.05 + Math.random() * 0.06,
  );

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.1 * vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11 + Math.random() * 0.05);

  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.5 - 0.75;

  o.connect(g);
  g.connect(pan);
  pan.connect(master);
  pan.connect(reverbSend);
  o.start(t);
  o.stop(t + 0.2);
}
