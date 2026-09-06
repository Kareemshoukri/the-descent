import { useEffect, useState } from "react";
import { useDive } from "../state/useDive";

/** Product identity and the single conversion action for the landing scene. */
export default function ProductCard() {
  const [open, setOpen] = useState(false);
  const depth = useDive((state) => state.depth);
  const scrollLocked = useDive((state) => state.scrollLocked);
  const visible = !scrollLocked && depth >= 118;

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  return (
    <aside className="productcard" data-visible={visible} hidden={!visible} aria-hidden={!visible} aria-label="Product information">
      <div className="productcard__eyebrow">MIKOZE / FIELD EQUIPMENT</div>
      <div className="productcard__name">Q930</div>
      <div className="productcard__type">UNDERWATER TORCH</div>
      <button className="productcard__cta" type="button" onClick={() => setOpen((value) => !value)}>
        {open ? "CLOSE" : "REQUEST INFO"}<span aria-hidden="true">↗</span>
      </button>
      {open && (
        <div className="productcard__panel" role="dialog" aria-label="Request product information">
          <p>Ask about the Q930, availability, or a field demo.</p>
          <a href="mailto:hello@mikoze.com?subject=MIKOZE%20Q930%20information">
            Email the product team <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}
    </aside>
  );
}
