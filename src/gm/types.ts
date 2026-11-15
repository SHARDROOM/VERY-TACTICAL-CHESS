import type { z } from 'zod';
import type { GameState } from '../engine';
import type { GmChaosSchema, GmEffectSchema, GmRulingSchema } from './schema';

/**
 * The ruling exactly as a GM (LLM or fake) returns it: plain JSON with
 * algebraic squares ("e4"). `parseGmRuling` turns it into an engine Ruling.
 */
export type GmRulingJson = z.infer<typeof GmRulingSchema>;
export type GmEffectJson = z.infer<typeof GmEffectSchema>;
export type GmChaosJson = z.infer<typeof GmChaosSchema>;

export interface GmRequest {
  /** The player's declaration, as typed. */
  action: string;
  state: GameState;
}

/** Anything that can rule on special actions. */
export interface GameMaster {
  readonly name: string;
  /** Returns raw JSON-like data; callers must run it through parseGmRuling. */
  rule(request: GmRequest): Promise<unknown>;
  /** Makes up a chaos event for the turn that is starting; callers run it through parseGmChaos. */
  chaos?(request: ChaosRequest): Promise<unknown>;
}

export interface ChaosRequest {
  state: GameState;
  /** A couple of random words to start from, so events differ from game to game (the GM may ignore them). */
  inspiration?: string[];
  /** Why the GM's previous idea for this turn was turned down, for its second try. */
  problem?: string;
}
