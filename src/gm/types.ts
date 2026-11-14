import type { GameState } from '../engine';

/**
 * The ruling exactly as a GM (LLM or fake) returns it: plain JSON with
 * algebraic squares ("e4"). `parseGmRuling` turns it into an engine Ruling.
 */
export interface GmRulingJson {
  interpretation: string;
  feasible: boolean;
  dc: number;
  cost: number;
  effects: GmEffectJson[];
  narration: { success: string; failure: string };
}

export type GmEffectJson = { type: 'move'; from: string; to: string } | { type: 'remove'; at: string };

export interface GmRequest {
  /** The player's declaration, as typed. */
  action: string;
  state: GameState;
}

/** Anything that can rule on special actions. Real LLM providers implement this in later tickets. */
export interface GameMaster {
  readonly name: string;
  /** Returns raw JSON-like data; callers must run it through parseGmRuling. */
  rule(request: GmRequest): Promise<unknown>;
}
