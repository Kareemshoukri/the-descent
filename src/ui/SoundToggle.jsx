import { useEffect, useState } from "react";
import * as audio from "../audio/audio";

/**
 * Audio can't legally start before a gesture, and shouldn't start without
 * consent either — so the first click anywhere unlocks it, and this stays
 * on screen so it can always be switched off again.
 */
export default function SoundToggle() {
  const [muted, setMuted] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const onFirst = () => {
      audio.unlock();
      setLive(true);
    };
    window.addEventListener("pointerdown", onFirst, { once: true });
    return () => window.removeEventListener("pointerdown", onFirst);
  }, []);

  const toggle = () => {
    audio.unlock();
    setLive(true);
    const next = !muted;
    setMuted(next);
    audio.setMuted(next);
  };

  return (
    <button
      className="soundtoggle"
      onClick={toggle}
      aria-label={muted ? "Unmute sound" : "Mute sound"}
      title={muted ? "Sound off" : "Sound on"}
    >
      <span className={`soundtoggle__bars ${muted || !live ? "is-off" : ""}`}>
        <i />
        <i />
        <i />
        <i />
      </span>
      {muted ? "sound off" : live ? "sound on" : "sound"}
    </button>
  );
}
