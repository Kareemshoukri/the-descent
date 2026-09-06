import { useEffect, useRef } from "react";
import { switchScreen } from "../state/switchScreen";
import { useDive } from "../state/useDive";

export default function SwitchControl() {
  const ref = useRef();
  const press = useRef(null);
  const on = useDive(s => s.on);
  useEffect(() => {
    let raf;
    const tick = () => {
      const el = ref.current;
      if (el) {
        el.style.left = `${switchScreen.x}px`;
        el.style.top = `${switchScreen.y}px`;
        el.style.width = el.style.height = `${switchScreen.r * 2}px`;
        el.style.visibility = switchScreen.live ? "visible" : "hidden";
        el.dataset.focused = String(useDive.getState().switchHover);
        if (!switchScreen.live) switchScreen.hovered = false;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); switchScreen.hovered = switchScreen.keyboardFocus = switchScreen.held = false; };
  }, []);
  const cancel = () => {
    press.current = null; switchScreen.held = false; switchScreen.cancel?.();
  };
  return <button ref={ref} className="switch-control" aria-label={on ? "Cycle torch mode" : "Switch on and dive"}
    onPointerEnter={e => { if (e.pointerType !== "touch") switchScreen.hovered = true; }}
    onPointerLeave={() => { switchScreen.hovered = false; switchScreen.suppressHover = false; }}
    onFocus={e => { switchScreen.suppressHover = false; switchScreen.keyboardFocus = e.currentTarget.matches(":focus-visible"); }}
    onBlur={() => { switchScreen.keyboardFocus = false; cancel(); }}
    onPointerDown={e => {
      if (e.button !== 0) return;
      e.stopPropagation();
      switchScreen.keyboardFocus = false;
      press.current = {x:e.clientX, y:e.clientY};
      switchScreen.held = true; switchScreen.press?.();
      e.currentTarget.setPointerCapture(e.pointerId);
    }}
    onPointerUp={e => {
      const start = press.current;
      const valid = start && Math.hypot(e.clientX-start.x,e.clientY-start.y) < 10;
      cancel();
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (valid) switchScreen.activate?.();
    }}
    onPointerCancel={cancel} onLostPointerCapture={cancel}
    onClick={e => { if (e.detail === 0) { switchScreen.press?.(); switchScreen.activate?.(); } }}
  />;
}
