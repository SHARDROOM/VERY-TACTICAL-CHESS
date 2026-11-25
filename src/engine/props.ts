/*
 * Props (조형물): small sculptures the GM builds out of primitive blocks, or calls up ready-made
 * by name. A prop is always the look of something with rules: a tag (a sword for 검술) or a
 * terrain feature (a bridge over a pit). docs/SPEC.md, "합과 조형물".
 *
 * Coordinates are in squares (a square is 1 wide). On a piece, x is the piece's right, y is up
 * and z is forward (toward the opponent), measured from where the prop is held or worn; on a
 * square, from the square's centre on the board. Rotations are in degrees.
 */

export const PROP_SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'wedge', 'torus'] as const;
export type PropShape = (typeof PROP_SHAPES)[number];

export const PROP_MATERIALS = ['wood', 'stone', 'iron', 'gold', 'cloth', 'rope', 'glass', 'glow'] as const;
export type PropMaterial = (typeof PROP_MATERIALS)[number];
export const PROP_MATERIAL_NAME: Record<PropMaterial, string> = { wood: '나무', stone: '돌', iron: '쇠', gold: '금', cloth: '천', rope: '밧줄', glass: '유리', glow: '빛남' };

export const PROP_PRESETS = ['sword', 'spear', 'shield', 'ladder', 'bridge', 'flag', 'crown', 'barricade', 'cannon', 'chapel', 'forge'] as const;
export type PropPreset = (typeof PROP_PRESETS)[number];
export const PROP_PRESET_NAME: Record<PropPreset, string> = { sword: '검', spear: '창', shield: '방패', ladder: '사다리', bridge: '다리', flag: '깃발', crown: '왕관', barricade: '바리케이드', cannon: '대포', chapel: '예배당', forge: '대장간' };

/** Where a prop goes on a piece. */
export const ATTACH_POINTS = ['rightHand', 'leftHand', 'head', 'back', 'feet'] as const;
export type AttachPoint = (typeof ATTACH_POINTS)[number];
export const ATTACH_NAME: Record<AttachPoint, string> = { rightHand: '오른손', leftHand: '왼손', head: '머리', back: '등', feet: '발밑' };

export type Vec3 = [number, number, number];

export interface PropPart {
  shape: PropShape;
  position: Vec3;
  /** Width, height, depth (a cylinder's width is its diameter). */
  size: Vec3;
  /** Degrees about x, y, z. */
  rotation: Vec3;
  material: PropMaterial;
  /** For cloth, glass and glow (and a tint for the rest): "#rrggbb". */
  color?: string;
}

export interface Prop {
  /** A ready-made shape, or null for the GM's own parts. */
  preset: PropPreset | null;
  parts: PropPart[];
  /** On a piece: where it is held or worn (ignored on a square). */
  attach: AttachPoint;
  /** Recolours a ready-made prop's cloth, glass and glow (a banner's colour). */
  color?: string;
  /** Overall size factor (0.5..2). */
  scale: number;
}

export const PROP_LIMITS = { parts: 20, extent: 1.5, minSize: 0.005, minScale: 0.5, maxScale: 2 } as const;

const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const vec = (v: unknown, fallback: number): Vec3 | null =>
  Array.isArray(v) && v.length === 3 ? [num(v[0], fallback), num(v[1], fallback), num(v[2], fallback)] : null;

/** One part, cleaned (out-of-range numbers pulled in), or null if it cannot be drawn. */
export function cleanPart(raw: unknown): PropPart | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!PROP_SHAPES.includes(r.shape as PropShape) || !PROP_MATERIALS.includes(r.material as PropMaterial)) return null;
  const position = vec(r.position, 0);
  const size = vec(r.size, 0.1);
  if (!position || !size) return null;
  const E = PROP_LIMITS.extent;
  return {
    shape: r.shape as PropShape,
    position: position.map((x) => clamp(x, -E, E)) as Vec3,
    size: size.map((x) => clamp(Math.abs(x), PROP_LIMITS.minSize, E)) as Vec3,
    rotation: (vec(r.rotation, 0) ?? [0, 0, 0]).map((x) => ((x % 360) + 360) % 360) as Vec3,
    material: r.material as PropMaterial,
    ...(isHex(r.color) && { color: r.color.toLowerCase() }),
  };
}

/**
 * A prop as the GM gave it, cleaned: an unknown preset or attach point, bad parts and parts past
 * the limit are dropped, numbers pulled into range. Null if nothing drawable is left.
 */
export function cleanProp(raw: unknown): Prop | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const preset = PROP_PRESETS.includes(r.preset as PropPreset) ? (r.preset as PropPreset) : null;
  const parts = preset ? [] : (Array.isArray(r.parts) ? r.parts : []).map(cleanPart).filter((p): p is PropPart => p !== null).slice(0, PROP_LIMITS.parts);
  if (!preset && !parts.length) return null;
  const attach = ATTACH_POINTS.includes(r.attach as AttachPoint) ? (r.attach as AttachPoint) : defaultAttach(preset);
  return {
    preset,
    parts,
    attach,
    ...(isHex(r.color) && { color: r.color.toLowerCase() }),
    scale: clamp(num(r.scale, 1) || 1, PROP_LIMITS.minScale, PROP_LIMITS.maxScale),
  };
}

/**
 * The buildings' looks (건물: a cannon on its carriage, a chapel, a smithy). They stand on a square,
 * never on a piece (사용자 요청: the GM put a cannon in a pawn's hand, as if it wore the building).
 */
export const BUILDING_PRESETS: readonly PropPreset[] = ['cannon', 'chapel', 'forge'];
export const isBuildingLook = (prop: Prop | null | undefined): boolean => !!prop?.preset && BUILDING_PRESETS.includes(prop.preset);

/** The looks a piece shows from its tags: each tag's prop, but never a building's (an older save may hold one). */
export function looksOnPiece<T extends { prop?: Prop }>(tags: readonly T[]): (T & { prop: Prop })[] {
  return tags.filter((t): t is T & { prop: Prop } => !!t.prop && !isBuildingLook(t.prop));
}

/** Where a ready-made prop goes when the GM did not say. */
export function defaultAttach(preset: PropPreset | null): AttachPoint {
  if (preset === 'shield') return 'leftHand';
  if (preset === 'crown') return 'head';
  if (preset === 'ladder') return 'back';
  if (preset === 'bridge' || preset === 'barricade') return 'feet';
  return 'rightHand';
}

const part = (shape: PropShape, position: Vec3, size: Vec3, material: PropMaterial, rotation: Vec3 = [0, 0, 0], color?: string): PropPart => ({
  shape,
  position,
  size,
  rotation,
  material,
  ...(color && { color }),
});

/** The ready-made props, as parts (held ones from the grip, worn ones from where they sit). */
export const PRESET_PARTS: Record<PropPreset, PropPart[]> = {
  sword: [
    part('sphere', [0, -0.08, 0], [0.05, 0.05, 0.05], 'gold'),
    part('cylinder', [0, -0.01, 0], [0.035, 0.12, 0.035], 'wood'),
    part('box', [0, 0.06, 0], [0.17, 0.025, 0.045], 'gold'),
    part('box', [0, 0.32, 0], [0.05, 0.5, 0.012], 'iron'),
    part('wedge', [0, 0.6, 0], [0.05, 0.07, 0.012], 'iron'),
  ],
  spear: [
    part('cylinder', [0, 0.25, 0], [0.028, 1.05, 0.028], 'wood'),
    part('cone', [0, 0.84, 0], [0.065, 0.16, 0.065], 'iron'),
    part('torus', [0, 0.75, 0], [0.05, 0.02, 0.05], 'rope'),
  ],
  shield: [
    part('cylinder', [0, 0, 0.05], [0.36, 0.035, 0.36], 'wood', [90, 0, 0]),
    part('torus', [0, 0, 0.05], [0.37, 0.035, 0.37], 'iron', [90, 0, 0]),
    part('sphere', [0, 0, 0.075], [0.08, 0.08, 0.05], 'iron'),
    part('box', [0, 0, 0.069], [0.03, 0.3, 0.004], 'cloth', [0, 0, 0], '#b23b3b'),
  ],
  ladder: [
    part('box', [-0.15, 0.4, 0], [0.045, 0.8, 0.045], 'wood'),
    part('box', [0.15, 0.4, 0], [0.045, 0.8, 0.045], 'wood'),
    ...[0.1, 0.28, 0.46, 0.64].map((y) => part('box', [0, y, 0], [0.3, 0.03, 0.035], 'wood')),
  ],
  bridge: [
    ...[-0.4, -0.24, -0.08, 0.08, 0.24, 0.4].map((x, i) => part('box', [x, 0.025, 0], [0.14, 0.04, 1.04], 'wood', [0, i % 2 ? 2 : -2, 0])),
    part('cylinder', [-0.49, 0.2, 0], [0.022, 1.04, 0.022], 'rope', [90, 0, 0]),
    part('cylinder', [0.49, 0.2, 0], [0.022, 1.04, 0.022], 'rope', [90, 0, 0]),
    ...[-0.49, 0.49].flatMap((x) => [-0.49, 0.49].map((z) => part('cylinder', [x, 0.12, z], [0.05, 0.24, 0.05], 'wood'))),
  ],
  flag: [
    part('cylinder', [0, 0.36, 0], [0.025, 0.95, 0.025], 'wood'),
    part('sphere', [0, 0.85, 0], [0.045, 0.045, 0.045], 'gold'),
    part('box', [0.15, 0.7, 0], [0.27, 0.17, 0.01], 'cloth', [0, 0, 0], '#b23b3b'),
  ],
  crown: [
    part('torus', [0, 0.03, 0], [0.24, 0.06, 0.24], 'gold'),
    ...[0, 72, 144, 216, 288].map((a) => {
      const r = (a * Math.PI) / 180;
      return part('cone', [Math.cos(r) * 0.11, 0.09, Math.sin(r) * 0.11], [0.045, 0.08, 0.045], 'gold');
    }),
    part('sphere', [0, 0.04, 0.12], [0.04, 0.04, 0.03], 'glass', [0, 0, 0], '#c0263a'),
  ],
  barricade: [
    part('cylinder', [0, 0.06, 0], [0.12, 0.92, 0.12], 'wood', [0, 0, 90]),
    part('box', [0, 0.28, 0], [0.86, 0.08, 0.08], 'wood', [0, 0, 28]),
    part('box', [0, 0.28, 0], [0.86, 0.08, 0.08], 'wood', [0, 0, -28]),
    ...[-0.3, 0, 0.3].map((x) => part('cone', [x, 0.32, 0.12], [0.06, 0.28, 0.06], 'iron', [70, 0, 0])),
  ],
  // The buildings (건물): a cannon on its carriage, a little chapel with a cross, a smithy with its anvil.
  cannon: [
    part('box', [0, 0.13, -0.04], [0.34, 0.12, 0.5], 'wood'),
    ...[-0.21, 0.21].map((x) => part('cylinder', [x, 0.15, -0.08], [0.3, 0.06, 0.3], 'wood', [0, 0, 90])),
    ...[-0.25, 0.25].map((x) => part('cylinder', [x, 0.15, -0.08], [0.08, 0.02, 0.08], 'iron', [0, 0, 90])),
    part('cylinder', [0, 0.3, 0.06], [0.15, 0.62, 0.15], 'iron', [72, 0, 0]),
    part('torus', [0, 0.39, 0.35], [0.17, 0.05, 0.17], 'iron', [72, 0, 0]),
    part('sphere', [0, 0.27, -0.32], [0.12, 0.12, 0.12], 'iron'),
    ...[-0.14, 0.14].map((x) => part('sphere', [x, 0.06, -0.33], [0.11, 0.11, 0.11], 'iron')),
  ],
  chapel: [
    part('box', [0, 0.22, 0], [0.56, 0.44, 0.66], 'stone'),
    part('wedge', [0, 0.56, 0], [0.64, 0.26, 0.74], 'wood', [0, 0, 0], '#5a3a2a'),
    part('box', [0, 0.15, 0.335], [0.15, 0.3, 0.02], 'wood'),
    part('box', [0, 0.36, 0.335], [0.1, 0.1, 0.02], 'glass', [0, 0, 0], '#f2c86a'),
    part('box', [0, 0.85, 0.22], [0.045, 0.26, 0.045], 'gold'),
    part('box', [0, 0.89, 0.22], [0.16, 0.045, 0.045], 'gold'),
  ],
  forge: [
    part('box', [-0.06, 0.17, -0.08], [0.5, 0.34, 0.46], 'stone'),
    part('wedge', [-0.06, 0.43, -0.08], [0.56, 0.18, 0.52], 'wood', [0, 0, 0], '#4a3020'),
    part('cylinder', [0.15, 0.5, -0.2], [0.12, 0.56, 0.12], 'stone'),
    part('sphere', [-0.06, 0.1, 0.16], [0.18, 0.1, 0.06], 'glow', [0, 0, 0], '#ff7a1a'),
    part('box', [0.2, 0.06, 0.28], [0.08, 0.12, 0.08], 'iron'),
    part('box', [0.2, 0.15, 0.28], [0.22, 0.06, 0.1], 'iron'),
    part('sphere', [0.16, 0.85, -0.18], [0.13, 0.11, 0.13], 'cloth', [0, 0, 0], '#8c8a86'),
    part('sphere', [0.2, 0.98, -0.14], [0.17, 0.13, 0.17], 'cloth', [0, 0, 0], '#a3a19c'),
  ],
};

/** A plain little house: a building of the GM's own (custom) that came with no look, nor a name that says which. */
export const BUILDING_HUT_PARTS: PropPart[] = [
  part('box', [0, 0.2, 0], [0.6, 0.4, 0.6], 'stone'),
  part('wedge', [0, 0.52, 0], [0.68, 0.24, 0.68], 'wood', [0, 0, 0], '#6b4528'),
  part('box', [0, 0.14, 0.305], [0.16, 0.28, 0.02], 'wood'),
  part('box', [0.18, 0.28, 0.305], [0.1, 0.1, 0.02], 'glass', [0, 0, 0], '#f2d48a'),
];

/** The parts a prop is drawn with: its own, or its preset's (with its colour on cloth, glass and glow). */
export function partsOf(prop: Prop): PropPart[] {
  if (!prop.preset) return prop.parts;
  return PRESET_PARTS[prop.preset].map((p) => (prop.color && (p.material === 'cloth' || p.material === 'glass' || p.material === 'glow') ? { ...p, color: prop.color } : p));
}

/** How far the prop reaches from its origin (in squares, before its scale). */
export function propReach(parts: readonly PropPart[]): number {
  let r = 0;
  for (const p of parts) {
    const half = Math.max(...p.size) / 2;
    r = Math.max(r, Math.hypot(...p.position) + half);
  }
  return r;
}
