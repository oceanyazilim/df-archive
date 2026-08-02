"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Mesh, MeshBasicMaterial } from "three";

/** A thin horizontal scan line sweeping through the model — distributor-search only, suggests active verification, not decoration. */
export function ScanEffect({ reducedMotion }: { reducedMotion: boolean }) {
  const ref = useRef<Mesh>(null);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    if (!ref.current) return;
    elapsed.current += reducedMotion ? delta * 0.3 : delta;
    const cycle = (elapsed.current * 0.4) % 1; // 0..1 loop
    const y = -0.85 + cycle * 1.7;
    ref.current.position.y = y;
    const mat = ref.current.material as MeshBasicMaterial;
    // Fade in/out at the top and bottom of the sweep so it never hard-cuts.
    mat.opacity = 0.32 * Math.sin(cycle * Math.PI);
  });

  return (
    <mesh ref={ref} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[1.6, 0.05]} />
      <meshBasicMaterial color="#39BDF8" transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}
