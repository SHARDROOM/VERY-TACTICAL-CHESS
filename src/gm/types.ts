import type { z } from 'zod';
import type { GameState } from '../engine';
import type { GmChaosSchema, GmEffectReplySchema, GmEffectSchema, GmRulingSchema } from './schema';
import type { ActRequest } from './player';

/**
 * The ruling exactly as a GM (LLM or fake) returns it: plain JSON with
 * algebraic squares ("e4"). `parseGmRuling` turns it into an engine Ruling.
 */
export type GmRulingJson = z.infer<typeof GmRulingSchema>;
export type GmEffectJson = z.infer<typeof GmEffectSchema>;
/** An effect as read from a reply (visual fields may be missing). */
export type GmEffectReplyJson = z.infer<typeof GmEffectReplySchema>;
export type GmChaosJson = z.infer<typeof GmChaosSchema>;

export interface GmRequest {
  /** The player's declaration, as typed. */
  action: string;
  state: GameState;
  /** Why the GM's previous ruling on this declaration was turned down, for its second try. */
  problem?: string;
}

/** Anything that can rule on special actions. */
export interface GameMaster {
  readonly name: string;
  /** Returns raw JSON-like data; callers must run it through parseGmRuling. */
  rule(request: GmRequest): Promise<unknown>;
  /** Makes up a chaos event for the turn that is starting; callers run it through parseGmChaos. */
  chaos?(request: ChaosRequest): Promise<unknown>;
  /** Makes up an AI player's declaration for its turn (player.ts); callers run it through parsePlayerAction. */
  act?(request: ActRequest): Promise<unknown>;
  /** Set by whoever runs the game: told when this GM goes on to a backup (예비 GM, failover.ts). */
  onNotice?: (text: string) => void;
}

export interface ChaosRequest {
  state: GameState;
  /** A couple of random words to start from, so events differ from game to game (the GM may ignore them). */
  inspiration?: string[];
  /** Why the GM's previous idea for this turn was turned down, for its second try. */
  problem?: string;
}
