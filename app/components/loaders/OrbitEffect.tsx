"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Group, Mesh, MeshBasicMaterial } from "three";
import type { Ocean3DLoaderMode } from "./types";

export interface OrbitEffectProps {
  mode: Ocean3DLoaderMode;
  reducedMotion: boolean;
  /** 0-1: for catalog-analysis, nodes drift inward as this rises; for success, drives the one-shot ring pulse. */
  progress01?: number;
  searchSubstage?: "metadata" | "uuid" | "alias" | "confidence" | "complete";
}

const RING_COLOR = "#39BDF8";
const NODE_COLOR = "#8B7CFF";

/**
 * Orbit ring + small data nodes, shared across distributor-search
 * (fast single orbit, nodes appear from the "alias" sub-stage on),
 * catalog-analysis (multiple faint orbits, nodes drift inward with real
 * progress), and success (one ring, expands once and fades — a
 * confirmation pulse, not a loop).
 */
export function OrbitEffect({ mode, reducedMotion, progress01 = 0, searchSubstage }: OrbitEffectProps) {
  const ringGroupRef = useRef<Group>(null);
  const nodesGroupRef = useRef<Group>(null);
  const successRingRef = useRef<Mesh>(null);
  const elapsed = useRef(0);

  const isDistributorSearch = mode === "distributor-search";
  const isCatalogAnalysis = mode === "catalog-analysis";
  const isSuccess = mode === "success";

  const nodeCount = isCatalogAnalysis ? 10 : isDistributorSearch ? 5 : 0;
  const nodeSeeds = useMemo(
    () => Array.from({ length: nodeCount }, (_, i) => ({ radius: 1.05 + (i % 3) * 0.14, speed: 0.35 + (i % 4) * 0.08, offset: (i / nodeCount) * Math.PI * 2, tilt: (i % 2 === 0 ? 1 : -1) * 0.12 })),
    [nodeCount]
  );

  // Distributor-search: nodes only appear once past the metadata sub-stage (per the spec's per-substage behavior).
  const nodesVisible = isCatalogAnalysis || (isDistributorSearch && searchSubstage && searchSubstage !== "metadata");
  const ringVisible = isDistributorSearch && searchSubstage !== "complete";

  useFrame((_, delta) => {
    const d = reducedMotion ? delta * 0.25 : delta;
    elapsed.current += d;
    const t = elapsed.current;

    if (ringGroupRef.current) {
      ringGroupRef.current.rotation.y += d * (isDistributorSearch ? 0.9 : 0.35);
      ringGroupRef.current.rotation.x = 0.32;
    }

    if (nodesGroupRef.current) {
      nodesGroupRef.current.children.forEach((child, i) => {
        const seed = nodeSeeds[i];
        if (!seed) return;
        const angle = t * seed.speed + seed.offset;
        const radius = isCatalogAnalysis ? seed.radius * (1 - Math.min(1, progress01) * 0.5) : seed.radius;
        child.position.set(Math.cos(angle) * radius, Math.sin(angle * 1.3) * seed.tilt, Math.sin(angle) * radius);
      });
    }

    if (isSuccess && successRingRef.current) {
      const p = Math.min(1, progress01);
      const scale = 0.9 + p * 0.7;
      successRingRef.current.scale.setScalar(scale);
      const mat = successRingRef.current.material as MeshBasicMaterial;
      mat.opacity = Math.max(0, 0.55 * (1 - p));
    }
  });

  return (
    <>
      {ringVisible && (
        <group ref={ringGroupRef}>
          <mesh>
            <torusGeometry args={[1.12, 0.006, 8, 96]} />
            <meshBasicMaterial color={RING_COLOR} transparent opacity={0.4} />
          </mesh>
        </group>
      )}

      {nodesVisible && (
        <group ref={nodesGroupRef}>
          {nodeSeeds.map((_, i) => (
            <mesh key={i}>
              <sphereGeometry args={[0.028, 8, 8]} />
              <meshBasicMaterial color={isCatalogAnalysis ? RING_COLOR : NODE_COLOR} transparent opacity={0.85} />
            </mesh>
          ))}
        </group>
      )}

      {isSuccess && (
        <mesh ref={successRingRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[1, 0.01, 8, 96]} />
          <meshBasicMaterial color={RING_COLOR} transparent opacity={0.55} />
        </mesh>
      )}
    </>
  );
}
