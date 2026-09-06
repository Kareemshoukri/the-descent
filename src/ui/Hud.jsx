import { useEffect, useRef, useState } from "react";
import { useDive, MODES, beatFor } from "../state/useDive";

/** The persistent readouts. The depth counter is the scrollbar — there is
 *  deliberately no second one. */
export default function Hud() {
  const [d, setD] = useState(0);
  const raf = useRef();
  const on = useDive((s) => s.on);
  const mode = useDive((s) => s.mode);

  useEffect(() => {
    const tick = () => {
      setD(useDive.getState().depth);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  const beat = beatFor(d);
  const m = MODES[mode];

  return (
    <div className="hud" data-surface={d < 3}>
      <div className="hud__depth">
        <b>−{d.toFixed(1)} m</b>
        <em>
          {beat.id} · {beat.name}
        </em>
      </div>

      <div className="hud__modes" data-off={!on}>
        {MODES.map((x, i) => (
          <i key={x.name} className={on && i === mode ? "active" : ""}>
            {x.name}
          </i>
        ))}
      </div>

      <div className="hud__runtime">{on ? `${m.lumens} lm · ${m.runtime}` : "OFF"}</div>

      {!on && (
        <div className="prompt">
          Drag to turn it over · press the switch to dive
          <span />
        </div>
      )}
    </div>
  );
}
