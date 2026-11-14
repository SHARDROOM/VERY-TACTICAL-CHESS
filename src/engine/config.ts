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
};
