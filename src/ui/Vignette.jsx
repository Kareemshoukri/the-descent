import { useEffect, useRef } from "react";
import { useDive, darkness } from "../state/useDive";

/**
 * Depth-aware. A flat, bright, textureless surface has nothing for a
 * vignette to blend into — edge-darkening against it reads as a glow
 * around the center, not a frame. Underwater, where the background is
 * already dark, the exact same gradient reads correctly. So this fades
 * in with darkness instead of running at a fixed strength throughout.
 *
 * Written directly to the DOM node's style, not React state — this
 * updates every frame and has no reason to go through a re-render.
 */
export default function Vignette() {
  const ref = useRef();

  useEffect(() => {
    let raf;
    const tick = () => {
      if (ref.current) {
        const d = darkness(useDive.getState().depth);
        ref.current.style.opacity = (0.08 + d * 0.92).toFixed(3);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <div ref={ref} className="vignette" aria-hidden="true" />;
}
