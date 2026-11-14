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
  /** Chance (0..1) that something chaotic happens at the start of each turn; 0 = off. */
  chaosChance: number;
  /** Whether anyone in the room may draw and write on the table. */
  doodle: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  apStart: 0,
  apPerTurn: 1,
  apMax: 5,
  costMin: 1,
  costMax: 3,
  dcMin: 5,
  dcMax: 25,
  actionMaxLength: 200,
  maxEffects: 8,
  turnSeconds: 0,
  timeoutPenalty: 1,
  chaosChance: 0,
  doodle: true,
};

/** Rules from a save or another version: anything missing takes the default. */
export function withDefaultRules(rules: Partial<RuleConfig> | undefined): RuleConfig {
  return { ...DEFAULT_RULES, ...(rules ?? {}) };
}
