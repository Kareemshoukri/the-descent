import { useEffect, useRef } from "react";
import { useDive } from "../state/useDive";

/**
 * A soft wash as you go under.
 *
 * The camera physically passes through the water plane at about a metre
 * down, and without anything covering it that crossing is a hard cut —
 * sky and a lit surface one frame, dark water the next. This peaks right
 * at the crossing and falls away either side, so the change of world
 * happens behind a veil instead of snapping.
 *
 * Driven straight onto the DOM node, not through React state: it updates
 * every frame and nothing needs to re-render for it.
 */
const PEAK = 1.0; // metres — where the camera meets the surface
// Narrow on purpose. At 2.2 m this was still half-opaque while sitting
// at the surface, washing out beat 01 entirely — the wash is meant to
// cover the instant of crossing, not the whole approach to it.
const WIDTH = 0.75;

export default function SurfaceFade() {
  const ref = useRef();

  useEffect(() => {
    let raf;
    const tick = () => {
      if (ref.current) {
        const { depth } = useDive.getState();
        const t = Math.abs(depth - PEAK) / WIDTH;
        const v = Math.max(0, 1 - t);
        // eased so it blooms and releases rather than ramping linearly
        ref.current.style.opacity = (v * v * (3 - 2 * v) * 0.72).toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div ref={ref} className="surfacefade" aria-hidden="true" />;
}
