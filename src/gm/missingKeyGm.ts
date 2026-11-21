import { GmError } from './errors';
import type { GameMaster } from './types';

/** Stands in for an LLM GM that has no API key yet. */
export class MissingKeyGameMaster implements GameMaster {
  readonly name: string;

  constructor(label: string) {
    this.name = `${label} (API 키 필요)`;
  }

  async rule(): Promise<never> {
    throw new GmError('API 키가 없습니다. ⚙ GM 설정에서 키를 입력해 주세요.', 'auth');
  }
}
