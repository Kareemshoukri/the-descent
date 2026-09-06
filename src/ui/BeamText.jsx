import { useEffect, useRef, useState } from "react";
import { useDive } from "../state/useDive";
import { beamScreen } from "../state/beamScreen";

/**
 * Frame 03 — the signature interaction, proved early.
 * Real DOM text (selectable, readable by a screen reader) that is masked
 * to the beam. The pointer aims the light; the copy exists all along.
 * A "light everything" toggle keeps it reachable for anyone who can't aim.
 */

/**
 * PLACEHOLDER COPY — not verified specifications.
 *
 * The storyboard's own notes say the source specs are placeholders and
 * were deliberately omitted, so nothing here should be published as fact
 * about the real Q930. Swap these for the real figures (or for copy that
 * isn't spec-shaped at all) before this goes anywhere public.
 */
const LINES = [
  { t: "6500 K COOL WHITE", x: 62, y: 26 },
  { t: "CREE XPG · TRIPLE EMITTER", x: 56, y: 38 },
  { t: "THROW · 210 m", x: 68, y: 50 },
  { t: "8° SPOT → WIDE FLOOD", x: 58, y: 62 },
  { t: "IP68 · RATED TO 100 m", x: 64, y: 74 },
];

export default function BeamText() {
  const [pos, setPos] = useState({ x: 50, y: 50 });
  const [pinned, setPinned] = useState({});
  const [revealAll, setRevealAll] = useState(false);
  const [visible, setVisible] = useState(false);
  const raf = useRef();

  useEffect(() => {
    const tick = () => {
      const { depth, on } = useDive.getState();
      setVisible(on && depth > 8 && depth < 34);
      // The mask follows the LIGHT, not the cursor. They coincide while
      // the beam has caught up, but the beam is damped — on a fast sweep
      // a cursor-driven mask reveals text the beam hasn't reached yet.
      if (beamScreen.live) setPos({ x: beamScreen.x, y: beamScreen.y });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(raf.current);
  }, []);

  if (!visible) return null;

  const mask = revealAll
    ? "none"
    : `radial-gradient(circle 190px at ${pos.x}% ${pos.y}%, #000 0%, #000 45%, transparent 100%)`;

  return (
    <div className="beamtext" aria-live="polite">
      <div className="beamtext__ghost">
        {LINES.map((l) => (
          <span
            key={l.t}
            style={{ left: `${l.x}%`, top: `${l.y}%` }}
            className={pinned[l.t] ? "pinned" : ""}
          >
            {l.t}
          </span>
        ))}
      </div>

      <div
        className="beamtext__lit"
        style={{ WebkitMaskImage: mask, maskImage: mask }}
      >
        {LINES.map((l) => (
          <span
            key={l.t}
            style={{ left: `${l.x}%`, top: `${l.y}%` }}
            onClick={() => setPinned((p) => ({ ...p, [l.t]: !p[l.t] }))}
          >
            {l.t}
          </span>
        ))}
      </div>

      <button
        className="revealall"
        onClick={() => setRevealAll((v) => !v)}
        aria-pressed={revealAll}
      >
        {revealAll ? "Beam only" : "Light everything"}
      </button>
    </div>
  );
}
