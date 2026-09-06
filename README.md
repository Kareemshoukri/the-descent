# The Descent — MIKOZE Q930

Interactive underwater landing page. **P0 is done: the rail runs.**
The torch on screen is a placeholder (capsule + cylinder) — everything around
it is the real system, waiting for the GLB.

## Run it

You need Node 18+ (`node -v` to check; if it's missing, get it from nodejs.org).

```bash
npm install     # once
npm run dev     # http://localhost:5173
```

`npm run build` produces `dist/` — that's what goes on Vercel later.

## What already works

- **Scroll = depth only.** Six screens of scroll map to 0 → −104 m. It reveals nothing.
- **The switch is on the object.** Click the small sphere on the body: the torch lights and scroll unlocks. Click it again to cycle HIGH / MED / LOW / STROBE / SOS.
- **Beam follows the pointer,** damped, never keyframed.
- **Wheel over the head** zooms the beam from spot to flood.
- **Frame 03, proved early:** between −8 and −34 m, spec lines exist in the dark and are masked to the beam. Click one to pin it. "Light everything" reveals them all — that's the accessibility path, not a cheat.
- **Debug panel:** press the backtick key (`` ` ``). Jump to any beat, scrub depth, watch fps. It ships; you'll use it for weeks.

## Where the model goes

Drop the exported file at `public/models/q930.glb`, then in
`src/scene/Torch.jsx` replace the three placeholder meshes with the loaded
scene. **Leave the beam rig alone** — the spotlight and cone are parented to
the same group, so they'll follow the real geometry with no changes.

Naming the parts in Blender exactly like this makes frame 05 (the exploded
view) almost free later:

```
part_lens  part_reflector  part_collar  part_emitter
part_seal  part_driver     part_cell    part_tail
```

Plus `explode.json` — each part name mapped to its offset in the exploded
render, so the web version separates the way your CAD frame does.

## Project map

```
src/
  state/useDive.js        one store: depth, mode, zoom, pointer, gates
  scroll/useScrollDepth   Lenis → depth, and the shared pointer
  scene/Scene.jsx         water colour ramp, fog, ambient light by depth
  scene/Torch.jsx         placeholder torch + the beam rig
  scene/Particles.jsx     backscatter
  ui/Hud.jsx              depth, modes, runtime
  ui/BeamText.jsx         frame 03 — masked copy
  ui/Debug.jsx            backtick panel
```

## Known placeholders

- All specs (1200 lm, 210 m throw, IP68) are invented until the real sheet lands.
- No sound, no post-processing, no touch or keyboard paths yet — those are P4 and P5.
- The water grade is rough. Look-dev is P2 and gets timeboxed to a week.
