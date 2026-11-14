import type { z } from 'zod';
import type { GameState } from '../engine';
import type { GmEffectSchema, GmRulingSchema } from './schema';

/**
 * The ruling exactly as a GM (LLM or fake) returns it: plain JSON with
 * algebraic squares ("e4"). `parseGmRuling` turns it into an engine Ruling.
 */
export type GmRulingJson = z.infer<typeof GmRulingSchema>;
export type GmEffectJson = z.infer<typeof GmEffectSchema>;

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
}
