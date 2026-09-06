import { useEffect } from "react";
import Lenis from "lenis";
import { useDive, MAX_DEPTH } from "../state/useDive";

/**
 * Scroll is a lift and nothing more: it maps scroll position to depth.
 * It never triggers a reveal — every reveal belongs to the pointer.
 */
/**
 * The live Lenis instance, so scripted moves (the ignition dive) can go
 * THROUGH the scroller instead of writing depth behind its back. Two
 * owners of depth is how you get a fight where the tween sets a value
 * and the next scroll event immediately overwrites it.
 */
let lenisRef = null;

/** Scripted descent, in metres, over `duration` seconds. */
export function scrollToDepth(metres, duration = 0.6) {
  if (!lenisRef) return;
  const limit =
    lenisRef.limit || document.documentElement.scrollHeight - window.innerHeight;
  const t = Math.min(1, Math.max(0, metres / MAX_DEPTH));
  lenisRef.scrollTo(t * limit, { duration, immediate: duration === 0 });
}

export function useScrollDepth() {
  useEffect(() => {
    const lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.9 });
    lenisRef = lenis;
    let raf;

    const loop = (t) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onScroll = ({ scroll, limit }) => {
      const { scrollLocked, setDepth } = useDive.getState();
      if (scrollLocked) {
        lenis.scrollTo(0, { immediate: true });
        return;
      }
      const t = limit > 0 ? scroll / limit : 0;
      setDepth(t * MAX_DEPTH);
    };

    lenis.on("scroll", onScroll);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      lenisRef = null;
    };
  }, []);
}

/**
 * Pointer, normalised to -1 → 1, shared by every beat.
 *
 * `pointermove` (not `mousemove`) on purpose: it fires for touch drags
 * too, which is what gives a phone any way at all to aim the beam —
 * there is no hover on touch, so a drag has to do the aiming.
 */
export function usePointer() {
  useEffect(() => {
    const onMove = (e) => {
      useDive
        .getState()
        .setPointer(
          (e.clientX / window.innerWidth) * 2 - 1,
          -((e.clientY / window.innerHeight) * 2 - 1),
        );
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
}
