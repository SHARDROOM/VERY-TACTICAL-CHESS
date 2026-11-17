import { useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, SRGBColorSpace, type Group, type Mesh } from 'three';

/** Endless little loops: drawn at the ambient rate (see renderPace). */
const AMBIENT = { vtcAmbient: true };

/** Little stars circling above a stunned piece. */
export function StunStars({ y }: { y: number }) {
  const ring = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ring.current) ring.current.rotation.y += dt * 2.2;
  });
  return (
    <group ref={ring} position={[0, y, 0]} userData={AMBIENT}>
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
    <mesh ref={mesh} position={[0, height / 2, 0]} userData={AMBIENT}>
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
 * A row (or, unfolded, a column) of small labels floating above a piece or a wall, drawn into
 * a texture (no DOM overlay) and always drawn on top so a turn count is never hidden behind
 * another piece. A column grows upward from `y`.
 */
export function TurnBadges({ chips, y, column = false, onClick }: { chips: Chip[]; y: number; column?: boolean; onClick?: (e: ThreeEvent<MouseEvent>) => void }) {
  const key = `${column ? 'col' : 'row'}/` + chips.map((c) => `${c.tone}:${c.text}`).join('|');
  const { texture, aspect, rows, rowShare } = useMemo(() => {
    const scale = 4;
    const font = `600 ${14 * scale}px system-ui, sans-serif`;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    const pad = 10 * scale;
    const dotW = 12 * scale;
    const gap = 6 * scale;
    const widths = chips.map((c) => Math.ceil(measure.measureText(c.text).width) + pad * 2 + (TONE[c.tone].dot ? dotW : 0));
    const rowH = 26 * scale;
    const width = Math.max(1, column ? Math.max(...widths) : widths.reduce((a, b) => a + b, 0) + gap * (chips.length - 1));
    const height = column ? rowH * chips.length + gap * (chips.length - 1) : rowH;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    let x = 0;
    // A column lists the first label at the bottom, nearest the piece.
    let top = height - rowH;
    chips.forEach((c, i) => {
      const tone = TONE[c.tone];
      const left = column ? (width - widths[i]) / 2 : x;
      ctx.fillStyle = tone.bg;
      ctx.beginPath();
      ctx.roundRect(left, column ? top : 0, widths[i], rowH, 10 * scale);
      ctx.fill();
      const mid = (column ? top : 0) + rowH / 2;
      let tx = left + pad;
      if (tone.dot) {
        ctx.fillStyle = tone.dot;
        ctx.beginPath();
        ctx.arc(tx + 4 * scale, mid, 4 * scale, 0, Math.PI * 2);
        ctx.fill();
        tx += dotW;
      }
      ctx.fillStyle = tone.fg;
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, tx, mid + scale);
      x += widths[i] + gap;
      top -= rowH + gap;
    });
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return { texture: t, aspect: width / height, rows: column ? chips.length : 1, rowShare: rowH / height };
  }, [key]);
  if (!chips.length) return null;
  // The same size on screen however far the camera is, so a count stays readable on a phone.
  const h = 0.03 * (rows === 1 ? 1 : 1 / rowShare);
  return (
    <sprite
      position={[0, y, 0]}
      scale={[h * aspect, h, 1]}
      // The bottom label sits where a single row would.
      center={[0.5, rowShare / 2]}
      renderOrder={20}
      onClick={onClick}
    >
      <spriteMaterial map={texture} transparent depthWrite={false} depthTest={false} sizeAttenuation={false} />
    </sprite>
  );
}

/** Which folded label colour wins: the most pressing one (a burning piece's last turn first). */
const URGENCY: ChipTone[] = ['burnLast', 'burn', 'stun', 'shield', 'free', 'terrain'];

/**
 * A piece's labels: one shows as it is; two or more fold into "⋯" (in the colours of the most
 * pressing one) that unfolds into a column when tapped, and folds again on a second tap.
 */
export function FoldingBadges({ chips, y }: { chips: Chip[]; y: number }) {
  const [open, setOpen] = useState(false);
  if (chips.length < 2) return <TurnBadges chips={chips} y={y} />;
  const tone = URGENCY.find((t) => chips.some((c) => c.tone === t)) ?? 'free';
  return (
    <TurnBadges
      chips={open ? chips : [{ text: '⋯', tone }]}
      y={y}
      column={open}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((o) => !o);
      }}
    />
  );
}
