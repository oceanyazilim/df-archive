import { useMemo } from "react";
import { Box3, Vector3, type Object3D } from "three";

export interface GltfFit {
  /** World-space center of the model's bounding box — subtract this before scaling to center it at the origin. */
  center: Vector3;
  /** Uniform scale that normalizes the model's largest dimension to `targetSize`. */
  scale: number;
}

/**
 * Computes how to re-center and normalize an arbitrary GLB so it always
 * appears centered and consistently sized regardless of how it was authored
 * (unknown origin, scale, or orientation in the source file). Apply as:
 *   <group scale={fit.scale}>
 *     <primitive object={scene} position={[-fit.center.x, -fit.center.y, -fit.center.z]} />
 *   </group>
 */
export function useGltfFit(object: Object3D | null | undefined, targetSize = 1): GltfFit {
  return useMemo(() => {
    if (!object) return { center: new Vector3(), scale: 1 };
    const box = new Box3().setFromObject(object);
    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    // Slight headroom so the model never clips its bounding frame while rotating.
    const scale = (targetSize / maxDim) * 0.92;
    return { center, scale };
  }, [object, targetSize]);
}
