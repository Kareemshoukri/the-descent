import { useEffect, useRef, useState } from "react";
import { useDive, BEATS, MAX_DEPTH } from "../state/useDive";
import { scrollToDepth } from "../scroll/useScrollDepth";

/**
 * Ship this. Backtick toggles it. You will use it for the next six weeks:
 * jump to any beat without diving there first, and watch the frame rate
 * while you do.
 */
export default function Debug() {
  const debug = useDive((s) => s.debug);
  const toggleDebug = useDive((s) => s.toggleDebug);
  const [d, setD] = useState(0);
  const [fps, setFps] = useState(0);
  const raf = useRef();
  const frames = useRef({ n: 0, t: performance.now() });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "`") toggleDebug();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDebug]);

  useEffect(() => {
    const tick = () => {
      if (!useDive.getState().debug) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      setD(useDive.getState().depth);
      const f = frames.current;
      f.n++;
      const now = performance.now();
      if (now - f.t > 500) {
        setFps(Math.round((f.n * 1000) / (now - f.t)));
        f.n = 0;
        f.t = now;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  if (!debug) return <div className="debug debug--hint">` debug</div>;

  const jump = (depth) => {
    const s = useDive.getState();
    s.setOn(true);
    s.setScrollLocked(false);
    s.setDepth(depth);
    scrollToDepth(depth, 0);
  };

  return (
    <div className="debug">
      <div className="debug__row">
        <span>fps</span>
        <b>{fps}</b>
      </div>
      <div className="debug__row">
        <span>depth</span>
        <b>{d.toFixed(1)} m</b>
      </div>
      <input
        type="range"
        min="0"
        max={MAX_DEPTH}
        step="0.5"
        value={d}
        onChange={(e) => jump(parseFloat(e.target.value))}
      />
      <div className="debug__beats">
        {BEATS.map((b) => (
          <button key={b.id} onClick={() => jump(b.depth)}>
            {b.id}
          </button>
        ))}
      </div>
    </div>
  );
}
