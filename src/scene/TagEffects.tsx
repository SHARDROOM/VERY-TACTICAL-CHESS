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

/** A small name tag floating above a piece, drawn into a texture (no DOM overlay). */
export function TagLabel({ text, y }: { text: string; y: number }) {
  const { texture, aspect } = useMemo(() => {
    const scale = 4;
    const font = `600 ${14 * scale}px system-ui, sans-serif`;
    const measure = document.createElement('canvas').getContext('2d')!;
    measure.font = font;
    const width = Math.ceil(measure.measureText(text).width) + 20 * scale;
    const height = 26 * scale;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(24, 25, 32, 0.85)';
    ctx.beginPath();
    ctx.roundRect(0, 0, width, height, 10 * scale);
    ctx.fill();
    ctx.fillStyle = '#f2d98b';
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, width / 2, height / 2 + scale);
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    return { texture: t, aspect: width / height };
  }, [text]);
  const h = 0.2;
  return (
    <sprite position={[0, y, 0]} scale={[h * aspect, h, 1]}>
      <spriteMaterial map={texture} transparent depthWrite={false} />
    </sprite>
  );
}
