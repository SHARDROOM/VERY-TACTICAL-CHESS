/** Every die in the game is a six-sided one (사용자 요청): special actions and clashes alike. */
export const DIE_SIDES = 6;
/** Every roll is two of them, added up (사용자 요청: 2..12, so the odds have more steps). */
export const DICE_PER_ROLL = 2;
/** The lowest and highest a roll can come to. */
export const ROLL_MIN = DICE_PER_ROLL;
export const ROLL_MAX = DICE_PER_ROLL * DIE_SIDES;

/** Balance numbers. Tune these from playtests; everything else reads them from the game state. */
export interface RuleConfig {
  /** AP each player has before their first turn starts. */
  apStart: number;
  /** AP gained at the start of each of your turns. */
  apPerTurn: number;
  apMax: number;
  costMin: number;
  costMax: number;
  dcMin: number;
  dcMax: number;
  /** Max characters in a special-action declaration. */
  actionMaxLength: number;
  /** Max effects a single ruling may contain. */
  maxEffects: number;
  /** Seconds a player has for one turn (GM thinking time not counted); 0 = no limit. */
  turnSeconds: number;
  /** AP lost when the time runs out; the turn then passes. */
  timeoutPenalty: number;
  /** AP for rolling a failed special action again (same ruling, same turn); 0 = no second tries. */
  rerollCost: number;
  /** Chance (0..1) that something chaotic happens at the start of each turn; 0 = off. */
  chaosChance: number;
  /** Whether anyone in the room may draw and write on the table. */
  doodle: boolean;
  /** The board: the classic 8×8 for two, or the three-player hexagon (docs/SPEC.md, "3인 육각 맵"). */
  map: 'classic' | 'hex3';
}

export const DEFAULT_RULES: RuleConfig = {
  apStart: 0,
  apPerTurn: 1,
  apMax: 5,
  costMin: 1,
  costMax: 3,
  dcMin: 3,
  dcMax: 12,
  actionMaxLength: 200,
  maxEffects: 8,
  turnSeconds: 0,
  timeoutPenalty: 1,
  rerollCost: 1,
  chaosChance: 0,
  doodle: true,
  map: 'classic',
};

/** Rules from a save or another version: anything missing takes the default. */
export function withDefaultRules(rules: Partial<RuleConfig> | undefined): RuleConfig {
  const out = { ...DEFAULT_RULES, ...(rules ?? {}) };
  if (out.map !== 'hex3') out.map = 'classic';
  // From the days of the d20 or a single d6: their DCs mean nothing on two dice.
  if (out.dcMax !== DEFAULT_RULES.dcMax || out.dcMin > out.dcMax) {
    out.dcMin = DEFAULT_RULES.dcMin;
    out.dcMax = DEFAULT_RULES.dcMax;
  }
  return out;
}
