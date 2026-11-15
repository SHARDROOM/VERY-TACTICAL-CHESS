import { useMemo } from 'react';
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
  type Material,
} from 'three';
import { ATTACH_POINTS, partsOf, propReach, type AttachPoint, type Color, type Prop, type PropMaterial, type PropPart, type PropShape } from '../engine';

/*
 * Draws a prop (조형물) from its parts: unit shapes stretched to each part's size, in one of the
 * prop materials. docs/SPEC.md, "합과 조형물".
 */

function wedge(): BufferGeometry {
  const s = new Shape();
  s.moveTo(-0.5, -0.5);
  s.lineTo(0.5, -0.5);
  s.lineTo(0, 0.5);
  s.closePath();
  const g = new ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
}

/** A torus lying flat, 1 across, its tube 0.2 thick (stretched to the part's height). */
const TORUS_TUBE = 0.2;
function flatTorus(): BufferGeometry {
  const g = new TorusGeometry(0.5 - TORUS_TUBE / 2, TORUS_TUBE / 2, 10, 28);
  g.rotateX(Math.PI / 2);
  return g;
}

const GEOMETRY: Record<PropShape, BufferGeometry> = {
  box: new BoxGeometry(1, 1, 1),
  cylinder: new CylinderGeometry(0.5, 0.5, 1, 20),
  cone: new ConeGeometry(0.5, 1, 20),
  sphere: new SphereGeometry(0.5, 20, 14),
  wedge: wedge(),
  torus: flatTorus(),
};

const BASE: Record<PropMaterial, { color: string; roughness: number; metalness?: number }> = {
  wood: { color: '#8a5a34', roughness: 0.78 },
  stone: { color: '#8d867c', roughness: 0.95 },
  iron: { color: '#d4d9df', roughness: 0.32, metalness: 0.55 },
  gold: { color: '#d9b24c', roughness: 0.28, metalness: 0.9 },
  cloth: { color: '#b23b3b', roughness: 1 },
  rope: { color: '#b89a6a', roughness: 1 },
  glass: { color: '#bfe3ff', roughness: 0.05 },
  glow: { color: '#ffd36b', roughness: 0.5 },
};

const materials = new Map<string, Material>();
/** One shared material per material and colour (cloth, glass and glow take the part's colour). */
function materialFor(p: PropPart): Material {
  const coloured = p.material === 'cloth' || p.material === 'glass' || p.material === 'glow';
  const color = (coloured && p.color) || BASE[p.material].color;
  const key = `${p.material}:${color}`;
  let m = materials.get(key);
  if (!m) {
    const b = BASE[p.material];
    m =
      p.material === 'glass'
        ? new MeshPhysicalMaterial({ color, roughness: b.roughness, transparent: true, opacity: 0.55, clearcoat: 1 })
        : new MeshStandardMaterial({
            color,
            roughness: b.roughness,
            metalness: b.metalness ?? 0,
            ...(p.material === 'glow' && { emissive: color, emissiveIntensity: 1.6 }),
          });
    materials.set(key, m);
  }
  return m;
}

const DEG = Math.PI / 180;

/** The scale that stretches a unit shape to a part's size. */
function stretch(p: PropPart): [number, number, number] {
  const [x, y, z] = p.size;
  return p.shape === 'torus' ? [x, y / TORUS_TUBE, z] : [x, y, z];
}

/**
 * A prop's parts, shrunk if needed so it reaches no further than `maxReach` (squares) from its
 * origin. The prop's own +z (forward) points along the scene's -z, the way a white piece faces.
 */
export function PropMesh({ prop, maxReach }: { prop: Prop; maxReach: number }) {
  const parts = useMemo(() => partsOf(prop), [prop]);
  const reach = propReach(parts) || 1;
  const s = Math.min(prop.scale, maxReach / reach);
  return (
    <group scale={[s, s, -s]}>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={GEOMETRY[p.shape]}
          material={materialFor(p)}
          position={p.position}
          rotation={[p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG]}
          scale={stretch(p)}
          castShadow
        />
      ))}
    </group>
  );
}

/** Where each attach point is on a piece of height `h`, facing forward (-z), and how it is held. */
function attachPose(point: AttachPoint, h: number): { position: [number, number, number]; tilt: number } {
  switch (point) {
    case 'rightHand':
      return { position: [0.27, 0.42 * h, -0.05], tilt: -0.26 };
    case 'leftHand':
      return { position: [-0.27, 0.42 * h, -0.05], tilt: -0.1 };
    case 'head':
      return { position: [0, h - 0.03, 0], tilt: 0 };
    case 'back':
      return { position: [0, 0.5 * h, 0.22], tilt: 0.25 };
    case 'feet':
      return { position: [0, 0.005, 0], tilt: 0 };
  }
}

/** A prop held or worn by a piece (turned to face the opponent): it moves with the piece. */
export function PropOnPiece({ prop, color, height }: { prop: Prop; color: Color; height: number }) {
  const pose = attachPose(ATTACH_POINTS.includes(prop.attach) ? prop.attach : 'rightHand', height);
  return (
    <group rotation={[0, color === 'white' ? 0 : Math.PI, 0]}>
      <group position={pose.position} rotation={[pose.tilt, 0, 0]}>
        <PropMesh prop={prop} maxReach={1.5 * height * 0.6} />
      </group>
    </group>
  );
}
