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
  /** distributor-search only — rotation calms as detection approaches a result, per the spec's per-substage behavior. */
  searchSubstage?: "metadata" | "uuid" | "alias" | "confidence" | "complete";
}

/**
 * Loads, clones, and fits the shared Ocean GLB. Cloning per instance (via
 * SkeletonUtils.clone, which safely handles both skinned and static meshes)
 * means multiple loaders on screen at once never mutate one shared Object3D.
 * Base idle motion lives here; per-mode elaboration (orbit rings, scan line,
 * data nodes) is layered on top by Ocean3DLoader in Phase D.
 */
export function OceanLogoScene({ mode, reducedMotion, progress01, searchSubstage }: OceanLogoSceneProps) {
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
        // Rotation driven by external progress (the transition's own timeline), not a continuous spin —
        // eased in/out, ~135deg total across the transition, with a small forward scale-in.
        const p = Math.min(1, Math.max(0, progress01 ?? 0));
        const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
        g.rotation.y = eased * (Math.PI * 0.75);
        g.scale.setScalar(0.94 + eased * 0.06);
        break;
      }
      case "distributor-search": {
        // Clean, steady rotation — faster while actively searching, calming
        // as the sub-stage approaches a result, settling front-on at completion.
        if (searchSubstage === "complete") {
          g.rotation.y *= 0.9;
          break;
        }
        const speed = searchSubstage === "confidence" ? 0.32 : 0.75;
        g.rotation.y += delta * speed;
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
        {/*
          dispose={null}: SkeletonUtils.clone() clones the node hierarchy but
          not the geometries/materials — those references are still owned by
          drei's useGLTF cache and shared with every other loader instance.
          Without this, R3F's default auto-dispose-on-unmount would free
          those shared resources the moment ANY one loader instance
          unmounts, breaking every other concurrently-mounted loader.
        */}
        <primitive object={cloned} position={[-fit.center.x, -fit.center.y, -fit.center.z]} dispose={null} />
      </group>
    </group>
  );
}
