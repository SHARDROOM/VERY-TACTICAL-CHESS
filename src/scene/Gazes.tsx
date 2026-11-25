import { useEffect, useMemo, useState } from 'react';
import { Quaternion, Vector3 } from 'three';
import { onGaze } from './toys';

/*
 * 상대 시선 (사용자 요청): where the other players look, as a faint line from their eye to what
 * their camera is turned on, with a ring where it lands. Told a few times a second over the room's
 * table channel (toys.ts); a player whose look has not come for a while fades out.
 */

type Side = 'white' | 'black' | 'red';
type Look = { from: [number, number, number]; at: [number, number, number]; seen: number };

/** The side's colour: light for white, cool blue for black (dark on the dark table would vanish), red for red. */
const TINT: Record<Side, string> = { white: '#fff1cf', black: '#8fb8ff', red: '#ff8f7a' };
/** A look not heard from for this long is gone (the player left, or stopped sending). */
const STALE_MS = 20_000;
const UP = new Vector3(0, 1, 0);

function GazeLine({ side, look }: { side: Side; look: Look }) {
  const { mid, length, quat, at } = useMemo(() => {
    const from = new Vector3(...look.from);
    const at = new Vector3(...look.at);
    // Start a little way out from the eye, so the line does not cross the viewer's own face as much.
    const start = from.clone().lerp(at, 0.25);
    const dir = at.clone().sub(start);
    const length = Math.max(dir.length(), 0.001);
    // A look with no length (cannot come from a camera, but it came over the network): straight down, not NaN.
    if (dir.lengthSq() < 1e-6) dir.set(0, -1, 0);
    return { mid: start.clone().add(at).multiplyScalar(0.5), length, quat: new Quaternion().setFromUnitVectors(UP, dir.normalize()), at };
  }, [look]);
  return (
    <group>
      <mesh position={mid} quaternion={quat} renderOrder={5}>
        <cylinderGeometry args={[0.025, 0.025, length, 6, 1, true]} />
        <meshBasicMaterial color={TINT[side]} transparent opacity={0.32} depthWrite={false} />
      </mesh>
      <mesh position={[at.x, Math.max(at.y, 0) + 0.03, at.z]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
        <ringGeometry args={[0.28, 0.36, 32]} />
        <meshBasicMaterial color={TINT[side]} transparent opacity={0.5} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function Gazes({ mySide }: { mySide: Side | null }) {
  const [looks, setLooks] = useState<Partial<Record<Side, Look>>>({});
  useEffect(
    () =>
      onGaze((op) => {
        if (op.id === mySide) return;
        setLooks((l) => ({ ...l, [op.id]: { from: op.from, at: op.at, seen: performance.now() } }));
      }),
    [mySide],
  );
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = performance.now();
      setLooks((l) => {
        const kept = Object.fromEntries(Object.entries(l).filter(([, v]) => v && now - v.seen < STALE_MS));
        return Object.keys(kept).length === Object.keys(l).length ? l : kept;
      });
    }, 5000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <>
      {(Object.entries(looks) as [Side, Look][]).map(([side, look]) => (
        <GazeLine key={side} side={side} look={look} />
      ))}
    </>
  );
}
