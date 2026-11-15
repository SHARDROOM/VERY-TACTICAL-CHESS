import { Color, MeshPhysicalMaterial } from 'three';

/**
 * How a piece beside the board looks after the way it left (docs/SPEC.md, "GM 연출"):
 * scorched after burning, muddy below after sinking, a ghost after vanishing.
 */
export type Finish = 'normal' | 'scorched' | 'mud' | 'ghost';

// Smooth 3D value noise, so soot and mud have ragged edges instead of straight lines.
const NOISE = /* glsl */ `
  float vtcHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float vtcNoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(vtcHash(i), vtcHash(i + vec3(1, 0, 0)), f.x), mix(vtcHash(i + vec3(0, 1, 0)), vtcHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(vtcHash(i + vec3(0, 0, 1)), vtcHash(i + vec3(1, 0, 1)), f.x), mix(vtcHash(i + vec3(0, 1, 1)), vtcHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
`;

const cache = new Map<string, MeshPhysicalMaterial>();

/**
 * The material for one part of a piece with this finish. `partY` is the part's height inside the
 * piece and `height` the piece's height, so the mud line sits at the same place on every part.
 */
export function finishMaterial(finish: Exclude<Finish, 'normal'>, base: string, partY: number, height: number, sheen: number): MeshPhysicalMaterial {
  const key = `${finish}|${base}|${partY.toFixed(3)}|${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let mat: MeshPhysicalMaterial;
  if (finish === 'ghost') {
    // A pale blue, see-through glow.
    mat = new MeshPhysicalMaterial({
      color: new Color(base).lerp(new Color('#cfe6ff'), 0.6),
      emissive: new Color('#6fb2ff'),
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      roughness: 0.2,
    });
  } else {
    mat = new MeshPhysicalMaterial({ color: base, roughness: finish === 'scorched' ? 0.85 : 0.5, clearcoat: finish === 'scorched' ? 0.05 : sheen * 0.6, clearcoatRoughness: 0.4 });
    const tint = finish === 'scorched' ? new Color('#17110d') : new Color('#4a3622');
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uPartY = { value: partY };
      shader.uniforms.uHeight = { value: height };
      shader.uniforms.uTint = { value: tint };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uPartY;\nvarying vec3 vPiecePos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPiecePos = position + vec3(0.0, uPartY, 0.0);');
      const body =
        finish === 'scorched'
          ? // Soot in patches, heavier toward the top where the flames were.
            'float soot = smoothstep(0.3, 0.7, vtcNoise(vPiecePos * 9.0)) * 0.6 + 0.3 * smoothstep(0.0, uHeight, vPiecePos.y);\n diffuseColor.rgb = mix(diffuseColor.rgb, uTint, clamp(soot + 0.15, 0.0, 0.92));'
          : // Mud up to a ragged line just under half its height.
            'float line = uHeight * 0.45 + (vtcNoise(vPiecePos * 11.0) - 0.5) * 0.12;\n float mud = smoothstep(line + 0.03, line - 0.03, vPiecePos.y);\n diffuseColor.rgb = mix(diffuseColor.rgb, uTint * (0.8 + 0.4 * vtcNoise(vPiecePos * 23.0)), mud * 0.92);';
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nuniform float uHeight;\nuniform vec3 uTint;\nvarying vec3 vPiecePos;\n${NOISE}`)
        .replace('#include <color_fragment>', `#include <color_fragment>\n${body}`);
    };
    mat.customProgramCacheKey = () => `vtc-${finish}`;
  }
  mat.userData.vtcFinish = true;
  cache.set(key, mat);
  return mat;
}
