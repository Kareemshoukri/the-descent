import { useProgress } from "@react-three/drei";

export default function LoadingScreen({ ready }) {
  const { progress, errors } = useProgress();
  if (ready) return null;
  const failed = errors.length > 0;
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-screen__content">
        <p className="loading-screen__label">PREPARING YOUR DIVE</p>
        <h1>THE DESCENT</h1>
        <div className="loading-screen__track" role="progressbar" aria-label="Loading scene" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}>
          <span style={{ transform: `scaleX(${progress / 100})` }} />
        </div>
        <p>{failed ? "Unable to load the scene. Please try again." : progress >= 100 ? "Bringing the ocean to life…" : `Loading the ocean · ${Math.round(progress)}%`}</p>
        {failed && <button onClick={() => window.location.reload()}>TRY AGAIN</button>}
      </div>
    </div>
  );
}
