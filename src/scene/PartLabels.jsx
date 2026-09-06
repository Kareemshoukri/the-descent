import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { useDive, explodeAt } from "../state/useDive";

/**
 * Names for the parts, shown while the torch is open at beat 05.
 *
 * Real DOM text rather than drawn labels: it stays selectable, scales
 * with the browser, is readable by a screen reader, and needs no font
 * asset — the same reasoning as the beam-reveal copy.
 *
 * Only the parts worth naming are here. Labelling all twenty-nine
 * (every washer, every screw) would be noise, and half of them are
 * hidden behind the others anyway.
 */
const NAMES = {
  part_Lens_glass: "Lens glass",
  part_bezel: "Bezel",
  part_oring_46mm: "O-ring · 46 mm",
  part_led_lip_a: "LED lip",
  part_driver_pcb: "Driver PCB",
  part_body: "Body",
  part_tailcap: "Battery tube",
};

const world = new THREE.Vector3();

/**
 * The assembly opens along one line, so labels sitting exactly on their
 * parts land on top of each other. They fan alternately above and below
 * it, stepping further out as they go — the standard exploded-diagram
 * arrangement, and the reason those diagrams stay readable.
 */
function labelOffset(i) {
  const side = i % 2 === 0 ? 1 : -1;
  return side * (0.34 + Math.floor(i / 2) * 0.28);
}

export default function PartLabels({ parts }) {
  const anchors = useRef([]);
  const wrap = useRef();

  const labelled = useMemo(() => {
    if (!parts) return [];
    return parts
      .filter((p) => NAMES[p.obj.name])
      .map((p) => ({ obj: p.obj, text: NAMES[p.obj.name] }));
  }, [parts]);

  useFrame(() => {
    if (!labelled.length) return;
    const { depth } = useDive.getState();
    const e = explodeAt(depth);

    // hidden outright when closed: an <Html> that is merely transparent
    // still costs a DOM node being positioned every frame
    if (wrap.current) wrap.current.visible = e > 0.02;
    if (e <= 0.02) {
      for (const a of anchors.current) if (a?.userData.el) a.userData.el.style.visibility = "hidden";
      return;
    }

    for (let i = 0; i < labelled.length; i++) {
      const a = anchors.current[i];
      if (!a) continue;
      // labels are top-level, so they take the part's WORLD position —
      // the parts themselves live inside the torch's own transform
      labelled[i].obj.geometry.boundingBox.getCenter(world);
      labelled[i].obj.localToWorld(world);
      a.position.copy(world);
      a.position.y += labelOffset(i) * e;
      const el = a.userData.el;
      if (el) { el.style.visibility = e > 0.15 ? "visible" : "hidden"; el.style.opacity = Math.min(1, (e - 0.15) / 0.35).toFixed(2); }
    }
  });

  if (!labelled.length) return null;

  return (
    <group ref={wrap}>
      {labelled.map((l, i) => (
        <group key={l.obj.name} ref={(el) => (anchors.current[i] = el)}>
          <Html center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div
              className="partlabel"
              ref={(el) => {
                if (anchors.current[i]) anchors.current[i].userData.el = el;
              }}
            >
              <i />
              {l.text}
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}
