import { GmError } from './errors';
import type { GameMaster } from './types';

/** Stands in for an LLM GM whose key was not re-entered after a reload (keys are never saved). */
export class MissingKeyGameMaster implements GameMaster {
  readonly name: string;

  constructor(label: string) {
    this.name = `${label} (API 키 필요)`;
  }

  async rule(): Promise<never> {
    throw new GmError('API 키는 저장되지 않아서 다시 입력해야 합니다. ⚙ GM 설정에서 키를 입력해 주세요.');
  }

  async chaos(): Promise<never> {
    return this.rule();
  }
}
