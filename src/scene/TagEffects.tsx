import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, type Group, type Mesh } from 'three';

/** Little stars circling above a stunned piece. */
export function StunStars({ y }: { y: number }) {
  const ring = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.y += dt * 2.2;
  });
  return (
    <group ref={ring} position={[0, y, 0]}>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * 0.2, Math.sin(a * 2) * 0.03, Math.sin(a) * 0.2]} rotation={[0.4, a, 0.3]}>
            <octahedronGeometry args={[0.055, 0]} />
            <meshStandardMaterial color="#ffd54a" emissive="#ffb300" emissiveIntensity={0.9} />
          </mesh>
        );
      })}
    </group>
  );
}

/** A soft translucent bubble around a shielded piece. */
export function ShieldBubble({ height }: { height: number }) {
  const mesh = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (mesh.current) {
      const s = 1 + Math.sin(clock.elapsedTime * 2.4) * 0.025;
      mesh.current.scale.set(0.46 * s, (height / 2 + 0.12) * s, 0.46 * s);
    }
  });
  return (
    <mesh ref={mesh} position={[0, height / 2, 0]}>
      <sphereGeometry args={[1, 32, 20]} />
      <meshPhysicalMaterial color="#7fc8ff" transparent opacity={0.22} roughness={0.1} depthWrite={false} emissive="#3d8bd6" emissiveIntensity={0.25} />
    </mesh>
  );
}

export type ChipTone = 'free' | 'stun' | 'shield' | 'burn' | 'burnLast' | 'terrain';

/** One label in a row above a piece: a tag (with the turns it has left) or a wall's or pit's turns. */
export interface Chip {
  text: string;
  tone: ChipTone;
}

const TONE: Record<ChipTone, { bg: string; dot: string | null; fg: string }> = {
  free: { bg: 'rgba(24, 25, 32, 0.86)', dot: null, fg: '#f2d98b' },
  stun: { bg: 'rgba(24, 25, 32, 0.86)', dot: '#ffd54a', fg: '#fff1c4' },
  shield: { bg: 'rgba(24, 25, 32, 0.86)', dot: '#7fc8ff', fg: '#d9efff' },
  burn: { bg: 'rgba(24, 25, 32, 0.86)', dot: '#ff7a2a', fg: '#ffd9bf' },
  // The last turn to move a burning piece: hard to miss.
  burnLast: { bg: 'rgba(178, 38, 30, 0.95)', dot: '#ffd54a', fg: '#ffffff' },
  terrain: { bg: 'rgba(52, 46, 40, 0.9)', dot: '#b9ad9c', fg: '#efe6d8' },
};

/**
 * A row of small labels floating above a piece (or a wall), drawn into a texture (no DOM
 * overlay) and always drawn on top so a turn count is never hidden behind another piece.
 */
export function TurnBadges({ chips, y }: { chips: Chip[]; y: number }) {
  const key = chips.map((c) => `${c.tone}:${c.text}`).join('|');
  const { texture, aspect } = useMemo(() => {
    const scale = 4;
    const font = `600 ${14 * scale}px system-ui, sans-serif`;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    const pad = 10 * scale;
    const dotW = 12 * scale;
    const gap = 6 * scale;
    const widths = chips.map((c) => Math.ceil(measure.measureText(c.text).width) + pad * 2 + (TONE[c.tone].dot ? dotW : 0));
    const width = Math.max(1, widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1));
    const height = 26 * scale;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    let x = 0;
    chips.forEach((c, i) => {
      const tone = TONE[c.tone];
      ctx.fillStyle = tone.bg;
      ctx.beginPath();
      ctx.roundRect(x, 0, widths[i], height, 10 * scale);
      ctx.fill();
      let tx = x + pad;
      if (tone.dot) {
        ctx.fillStyle = tone.dot;
        ctx.beginPath();
        ctx.arc(tx + 4 * scale, height / 2, 4 * scale, 0, Math.PI * 2);
        ctx.fill();
        tx += dotW;
      }
      ctx.fillStyle = tone.fg;
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, tx, height / 2 + scale);
      x += widths[i] + gap;
    });
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return { texture: t, aspect: width / height };
  }, [key]);
  if (!chips.length) return null;
  // The same size on screen however far the camera is, so a count stays readable on a phone.
  const h = 0.03;
  return (
    <sprite position={[0, y, 0]} scale={[h * aspect, h, 1]} renderOrder={20}>
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} sizeAttenuation={false} />
    </sprite>
  );
}
