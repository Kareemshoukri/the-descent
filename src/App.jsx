import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import LoadingScreen from "./ui/LoadingScreen";
import { compact } from "./quality";
import Scene from "./scene/Scene";
import SwitchControl from "./ui/SwitchControl";
import Hud from "./ui/Hud";
import Debug from "./ui/Debug";
import BeamText from "./ui/BeamText";
import Vignette from "./ui/Vignette";
import SurfaceFade from "./ui/SurfaceFade";
import SoundToggle from "./ui/SoundToggle";
import ProductCard from "./ui/ProductCard";
import { useScrollDepth, usePointer } from "./scroll/useScrollDepth";

function FirstFrame({ onReady }) {
  const frames = useRef(0);
  useFrame(() => { if (++frames.current === 3) onReady(); });
  return null;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const onReady = useCallback(() => setReady(true), []);
  useEffect(() => {
    if (ready) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [ready]);
  useScrollDepth();
  usePointer();

  return (
    <>
      <div className="stage">
        <Canvas
          camera={{ position: [0, 0, 3.4], fov: 42 }}
          dpr={compact ? 1 : [1, 1.5]}
          gl={{ antialias: !compact, powerPreference: "high-performance" }}
        >
          <Suspense fallback={null}>
            <Scene />
            <FirstFrame onReady={onReady} />
          </Suspense>
        </Canvas>
      </div>

      <div inert={ready ? undefined : ""} aria-hidden={!ready}>
      <Vignette />
      <SurfaceFade />
      <BeamText />
      <Hud />
      <SwitchControl />
      <SoundToggle />
      <ProductCard />
      <Debug />
      </div>
      <LoadingScreen ready={ready} />

      {/* the lift shaft: six screens of scroll, and nothing in it */}
      <div className="shaft" aria-hidden="true" />
    </>
  );
}
