import { create } from "zustand";

/**
 * One store, one source of truth.
 * `depth` (0 → 130 m) drives every visual in the scene: colour, fog,
 * pressure, HUD. Nothing else is allowed to own a timeline.
 */

export const BEATS = [
  { id: "01", name: "Surface", depth: 0 },
  { id: "02", name: "Ignition", depth: 2 },
  { id: "03", name: "Beam reveal", depth: 15 },
  { id: "04", name: "Pressure", depth: 40 },
  { id: "05", name: "Anatomy", depth: 70 },
  { id: "06", name: "Modes", depth: 100 },
  { id: "07", name: "Fish pass", depth: 108 },
  { id: "08", name: "Wreck floor", depth: 126 },
];

export const MODES = [
  { name: "HIGH", lumens: 1200, runtime: "1 h 50", intensity: 1.0 },
  { name: "MED", lumens: 600, runtime: "4 h", intensity: 0.6 },
  { name: "LOW", lumens: 180, runtime: "12 h", intensity: 0.28 },
  { name: "STROBE", lumens: 1200, runtime: "3 h", intensity: 1.0 },
  { name: "SOS", lumens: 600, runtime: "6 h", intensity: 0.7 },
];

export const MAX_DEPTH = 130;

export const useDive = create((set, get) => ({
  // --- depth -------------------------------------------------------
  depth: 0,
  setDepth: (d) => set({ depth: Math.min(MAX_DEPTH, Math.max(0, d)) }),

  // --- torch state -------------------------------------------------
  on: false,
  setOn: (v) => set({ on: v }),
  mode: 0,
  cycleMode: () => set({ mode: (get().mode + 1) % MODES.length }),
  /** 0 = 8° spot, 1 = wide flood. Mouse wheel over the head. */
  zoom: 0.15,
  setZoom: (z) => set({ zoom: Math.min(1, Math.max(0, z)) }),

  // --- input -------------------------------------------------------
  /** normalised pointer, -1 → 1 on both axes */
  pointer: { x: 0, y: 0 },
  setPointer: (x, y) => set({ pointer: { x, y } }),

  /** clock time of the ignition press, for the beat-02 camera move */
  ignitedAt: 0,
  setIgnitedAt: (t) => set({ ignitedAt: t }),
  /** cursor is over the switch — holds the macro camera in close */
  switchHover: false,
  setSwitchHover: (v) => set({ switchHover: v }),

  // --- gates -------------------------------------------------------
  /** scroll is locked until the torch is switched on (frame 01) */
  scrollLocked: true,
  setScrollLocked: (v) => set({ scrollLocked: v }),

  // --- dev ---------------------------------------------------------
  debug: false,
  toggleDebug: () => set({ debug: !get().debug }),
}));

// the store on the window, for the debug panel's sake and for driving the
// scene from a console or a test without going through the scroller
if (typeof window !== "undefined") window.__dive = useDive;

/** Which beat are we in, from depth alone. */
export function beatFor(depth) {
  let current = BEATS[0];
  for (const b of BEATS) if (Math.round(depth * 10) / 10 >= b.depth) current = b;
  return current;
}

/**
 * How far apart the torch is at a given depth. Beat 05 sits at -70 m, so
 * it opens on the way down and closes again on the way past — the piece
 * is one continuous dive, not a set of separate scenes.
 */
export function explodeAt(depth) {
  if (depth < 56 || depth > 94) return 0;
  if (depth < 68) return (depth - 56) / 12;
  if (depth < 82) return 1;
  return 1 - (depth - 82) / 12;
}

/**
 * How far the torch is cut open at a given depth — beat 04, Pressure.
 *
 * This is a real section through the real model, not a second "cutaway"
 * export: a clipping plane sweeps down through the housing, so what you
 * see inside is the geometry that was always there. One model, one
 * source of truth, and it animates because a plane can move — a boolean
 * would have to rebuild the mesh every frame.
 *
 * It opens on the way down, holds through the beat, and has closed again
 * before the exploded view starts at 56 m, so the two never fight.
 */
export function sectionAt(depth) {
  if (depth < 28 || depth > 54) return 0;
  if (depth < 38) return (depth - 28) / 10;
  if (depth < 47) return 1;
  return 1 - (depth - 47) / 7;
}

/** 0 at the surface, 1 in full dark — the master mix for the whole look. */
export function darkness(depth) {
  return Math.min(1, depth / 38);
}
