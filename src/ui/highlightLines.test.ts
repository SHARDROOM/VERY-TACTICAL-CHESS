import { describe, expect, it } from 'vitest';
import { highlightLines } from './messages';

describe('명장면 on the end screen', () => {
  it('says what happened, how likely it was, and who took the most', () => {
    const lines = highlightLines({
      miracle: { turnNumber: 5, color: 'black', action: '말도 안 되는 저격', chance: 3 / 36 },
      heartbreak: { turnNumber: 9, color: 'white', action: '쉬운 다리 놓기', chance: 33 / 36, fumble: true, spent: 1 },
      mvp: { id: 'x', color: 'white', type: 'knight', n: 4, alive: false },
    });
    expect(lines.map((l) => `${l.title} ${l.text}`)).toEqual([
      '✨ 기적 5턴 흑의 “말도 안 되는 저격”, 성공 확률 8%를 뚫고 성공',
      '💔 통한 9턴 백의 “쉬운 다리 놓기”, 성공 확률 92%였는데 1·1 대실패',
      '👑 MVP 백 나이트, 기물 4개를 잡음 (끝내 쓰러짐)',
    ]);
  });

  it('a plain failure says what it cost; a long declaration is cut short; none, no lines', () => {
    const [line] = highlightLines({ heartbreak: { turnNumber: 2, color: 'red', action: '가'.repeat(60), chance: 0.42, fumble: false, spent: 3 } });
    expect(line.text).toBe(`2턴 적의 “${'가'.repeat(39)}…”, AP를 3 쓰고 실패 (성공 확률 42%)`);
    expect(highlightLines({})).toEqual([]);
  });
});
