import { useMemo } from 'react';
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { tableHalf } from './coords';

/** Top surface height: the board frame's underside rests on it. */
export const TABLE_TOP_Y = -0.22;
const TABLE = { thickness: 0.7 };

/** Long planks with grain, knots and seams, painted once into a texture (no image downloads). */
function useWoodTexture() {
  return useMemo(() => {
    const w = 2048;
    const h = 1024;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const planks = 6;
    const ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const y0 = p * ph;
      const tone = 0.85 + rnd() * 0.25;
      ctx.fillStyle = `rgb(${Math.round(108 * tone)}, ${Math.round(70 * tone)}, ${Math.round(42 * tone)})`;
      ctx.fillRect(0, y0, w, ph);
      // Grain: many thin wavy lines along the plank.
      for (let g = 0; g < 70; g++) {
        const gy = y0 + rnd() * ph;
        const amp = 2 + rnd() * 6;
        const freq = 0.002 + rnd() * 0.006;
        const phase = rnd() * Math.PI * 2;
        ctx.strokeStyle = rnd() < 0.5 ? `rgba(40, 22, 10, ${0.08 + rnd() * 0.18})` : `rgba(170, 120, 75, ${0.05 + rnd() * 0.12})`;
        ctx.lineWidth = 0.6 + rnd() * 2.2;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 16) {
          const yy = gy + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase) * amp * 0.3;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      // A knot or two.
      for (let k = 0; k < (rnd() < 0.6 ? 1 : 2); k++) {
        const kx = rnd() * w;
        const ky = y0 + ph * (0.3 + rnd() * 0.4);
        for (let r = 3; r < 26; r += 3) {
          ctx.strokeStyle = `rgba(45, 25, 12, ${0.35 - r * 0.011})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(kx, ky, r * 2.2, r * 0.8, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Seam between planks.
      ctx.fillStyle = 'rgba(25, 14, 6, 0.85)';
      ctx.fillRect(0, y0, w, 3);
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.anisotropy = 8;
    return t;
  }, []);
}

/** A big wooden table under the board (and the dice tray), on a dark floor. */
export function WoodTable() {
  const wood = useWoodTexture();
  const [hw, hd] = tableHalf();
  const { thickness } = TABLE;
  // A little wider than the reach of things on it (see tableHalf).
  const width = hw * 2;
  const depth = hd * 2;
  const legX = width / 2 - 1.2;
  const legZ = depth / 2 - 1.2;
  return (
    <group>
      <mesh position={[0, TABLE_TOP_Y - thickness / 2, 0]} receiveShadow castShadow>
        <boxGeometry args={[width, thickness, depth]} />
        <meshStandardMaterial map={wood} roughness={0.62} metalness={0.02} />
      </mesh>
      {[
        [legX, legZ],
        [-legX, legZ],
        [legX, -legZ],
        [-legX, -legZ],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, TABLE_TOP_Y - thickness - 3.4, z]} castShadow>
          <boxGeometry args={[1, 6.8, 1]} />
          <meshStandardMaterial color="#4a2e1a" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[0, TABLE_TOP_Y - thickness - 6.8, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[120, 120]} />
        <meshStandardMaterial color="#17130f" roughness={1} />
      </mesh>
    </group>
  );
}
