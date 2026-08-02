"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { SkeletonUtils } from "three-stdlib";
import type { Group } from "three";
import oceanModelUrl from "../../../src/assets/Ocean-3D-LOGO.glb";
import { useGltfFit } from "../../lib/hooks/useGltfFit";
import type { Ocean3DLoaderMode } from "./types";

// Starts fetching as soon as this module is evaluated, so the model is
// usually already cached by the time the first loader mounts.
useGLTF.preload(oceanModelUrl);

export interface OceanLogoSceneProps {
  mode: Ocean3DLoaderMode;
  reducedMotion: boolean;
  /** 0-1 external progress driver — used by page-transition (rotation tied to transition progress) and success (settle-to-front). */
  progress01?: number;
}

/**
 * Loads, clones, and fits the shared Ocean GLB. Cloning per instance (via
 * SkeletonUtils.clone, which safely handles both skinned and static meshes)
 * means multiple loaders on screen at once never mutate one shared Object3D.
 * Base idle motion lives here; per-mode elaboration (orbit rings, scan line,
 * data nodes) is layered on top by Ocean3DLoader in Phase D.
 */
export function OceanLogoScene({ mode, reducedMotion, progress01 }: OceanLogoSceneProps) {
  const { scene } = useGLTF(oceanModelUrl);
  const cloned = useMemo(() => SkeletonUtils.clone(scene), [scene]);
  const fit = useGltfFit(cloned, 1.6);
  const groupRef = useRef<Group>(null);
  const elapsed = useRef(0);

  useFrame((_, delta) => {
    const g = groupRef.current;
    if (!g) return;
    elapsed.current += delta;
    const t = elapsed.current;

    if (reducedMotion) {
      // No continuous rotation — a slow, gentle opacity-adjacent pulse via scale instead.
      const pulse = 1 + Math.sin(t * 0.6) * 0.015;
      g.scale.setScalar(pulse);
      return;
    }

    switch (mode) {
      case "app-initialization": {
        g.rotation.y += delta * 0.28;
        g.position.y = Math.sin(t * 0.5) * 0.035;
        g.scale.setScalar(1 + Math.sin(t * 0.7) * 0.02);
        break;
      }
      case "page-transition": {
        // Rotation driven externally by progress01 (see Ocean3DLoader) rather than continuous spin.
        break;
      }
      case "distributor-search": {
        // Faster rotation with a small periodic reverse micro-correction, plus a slight Z tilt.
        const dir = Math.sin(t * 0.35) > 0.85 ? -1 : 1;
        g.rotation.y += delta * 0.9 * dir;
        g.rotation.z = Math.sin(t * 0.8) * 0.05;
        break;
      }
      case "catalog-analysis": {
        g.rotation.y += delta * 0.5;
        g.position.y = Math.sin(t * 0.4) * 0.025;
        break;
      }
      case "success": {
        // Settle toward front-facing (rotation.y -> 0) with a restrained scale pop, driven by progress01.
        g.rotation.y *= 0.9;
        const p = progress01 ?? 1;
        g.scale.setScalar(1 + Math.sin(Math.min(1, p) * Math.PI) * 0.04);
        break;
      }
    }
  });

  return (
    <group ref={groupRef}>
      <group scale={fit.scale}>
        <primitive object={cloned} position={[-fit.center.x, -fit.center.y, -fit.center.z]} />
      </group>
    </group>
  );
}
