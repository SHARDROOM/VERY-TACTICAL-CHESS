import { createStateFrom, legalTargets, parseSquare, squareName, type GameEvent, type GameState, type PieceType, type Square } from '../engine';
import { josa } from '../ui/josa';
import { PIECE_NAME } from '../ui/messages';

/*
 * 따라하기 (사용자 요청): a first game on a small board, step by step: move a piece, see the AP,
 * declare something the rules of chess do not have, throw the dice, see the precedent it left,
 * and off you go. The GM is the fake one (no key needed), the dice are kind the first time, and
 * black answers with quiet pawn moves until the lesson is over. docs/SPEC.md, "따라하기".
 */

export type TutorialStep = 'move' | 'reply' | 'ap' | 'declare' | 'dice' | 'precedent' | 'end';

export const STEP_ORDER: TutorialStep[] = ['move', 'reply', 'ap', 'declare', 'dice', 'precedent', 'end'];

/** What the coach says at each step (`{action}`: the declaration suggested for this board). */
export const STEP_TEXT: Record<TutorialStep, { title: string; text: string }> = {
  move: { title: '1. 기물 옮기기', text: '여느 체스처럼 기물을 눌러 옮겨 보세요. 백 폰을 누르면 갈 수 있는 칸이 빛납니다. 입력칸에 "e2e4"처럼 써도 됩니다.' },
  reply: { title: '1. 기물 옮기기', text: '좋습니다. 이제 흑이 둡니다…' },
  ap: { title: '2. AP(금화)', text: '내 차례가 올 때마다 금화(AP)가 하나씩 쌓입니다. 화면 아래 탁자의 금화가 지금 가진 AP입니다. AP는 체스 규칙에 없는 "특수 행동"에 씁니다.' },
  declare: { title: '3. 특수 행동 선언', text: '체스에 없는 일도 문장으로 쓰면 GM이 판정합니다. 누가(내 기물의 칸) 무엇에 하는지 쓰세요. 예: "{action}". 아래 버튼으로 입력칸에 넣고 [입력]을 누르세요.' },
  dice: { title: '4. 주사위', text: 'GM이 난이도(DC)와 드는 AP를 정했습니다. 주사위 두 개의 합이 DC 이상이면 성공입니다. [주사위 굴리기]를 눌러 보세요.' },

  precedent: { title: '5. 판례', text: '방금 판정은 판례로 남았습니다. 위쪽의 판례 버튼(숫자가 붙은 것)으로 다시 볼 수 있고, GM은 비슷한 선언을 비슷하게 판정합니다. 특수 행동을 한 뒤에도 그 턴의 수는 둘 수 있습니다.' },
  end: { title: '6. 이제 실전으로', text: '상대 킹을 잡으면 이깁니다. 기권과 무승부는 ⚙ 설정에, 무르기는 턴 종료 옆에 있습니다. 진짜 GM(Claude, OpenAI, Gemini)은 설정에서 API 키를 넣으면 켜집니다.' },
};

/** One line for a step while the ruling sheet fills the screen (the sheet itself shows the DC and the chance). */
export const STEP_SHORT: Partial<Record<TutorialStep, string>> = {
  dice: '4. 주사위: 두 개의 합이 DC 이상이면 성공. 아래 [주사위 굴리기]를 누르세요.',
};

/** The lesson's board: a few pieces a side, white to move with AP enough for a special action. */
export function tutorialState(): GameState {
  const s = createStateFrom(
    {
      e1: { color: 'white', type: 'king' },
      d1: { color: 'white', type: 'queen' },
      c1: { color: 'white', type: 'bishop' },
      b1: { color: 'white', type: 'knight' },
      c2: { color: 'white', type: 'pawn' },
      d2: { color: 'white', type: 'pawn' },
      e2: { color: 'white', type: 'pawn' },
      f2: { color: 'white', type: 'pawn' },
      e8: { color: 'black', type: 'king' },
      d8: { color: 'black', type: 'queen' },
      g8: { color: 'black', type: 'knight' },
      c7: { color: 'black', type: 'pawn' },
      d5: { color: 'black', type: 'pawn' },
      e7: { color: 'black', type: 'pawn' },
      h7: { color: 'black', type: 'pawn' },
    },
    'white',
  );
  return { ...s, ap: { ...s.ap, white: 2, black: 2 } };
}

/** Black's quiet answers, in order: the first one legal now. */
const REPLIES = ['h7h6', 'h6h5', 'c7c6', 'g8f6', 'e7e6', 'h5h4', 'c6c5', 'e6e5'];

export function blackReply(state: GameState): { from: Square; to: Square } | null {
  for (const r of REPLIES) {
    const from = parseSquare(r.slice(0, 2))!;
    const to = parseSquare(r.slice(2))!;
    if (state.board[from]?.color === 'black' && legalTargets(state, from).some((t) => t.to === to)) return { from, to };
  }
  return null;
}

/** A spell the lesson suggests: white's bishop (or queen, or any piece) stuns black's nearest pawn. */
export function suggestedDeclaration(state: GameState): string {
  const mine = (type: PieceType) => state.board.findIndex((p) => p?.color === 'white' && p.type === type);
  const actor = [mine('bishop'), mine('queen'), mine('knight')].find((i) => i >= 0) ?? state.board.findIndex((p) => p?.color === 'white' && p.type !== 'king');
  const pawns = state.board.flatMap((p, sq) => (p?.color === 'black' && p.type === 'pawn' ? [sq] : []));
  const target = pawns.sort((a, b) => Math.abs(a - actor) - Math.abs(b - actor))[0];
  if (actor < 0 || target === undefined) return '';
  const who = josa(`${squareName(actor)} ${PIECE_NAME[state.board[actor]!.type]}`, '이/가');
  return `${who} 주문을 외워 ${squareName(target)} 폰을 기절시킨다`;
}

/** The step after these events (or the same one). Info steps (ap, precedent, end) move on by the player's "다음". */
export function stepAfter(step: TutorialStep, events: readonly GameEvent[]): TutorialStep {
  const passed = events.find((e) => e.type === 'turnPassed');
  if (step === 'move' && passed?.type === 'turnPassed' && passed.ended === 'white') return 'reply';
  if (step === 'reply' && passed?.type === 'turnPassed' && passed.ended === 'black') return 'ap';
  if (step === 'declare' && events.some((e) => e.type === 'specialProposed')) return 'dice';
  if (step === 'dice' && events.some((e) => e.type === 'specialResolved')) return 'precedent';
  if (step === 'dice' && events.some((e) => e.type === 'specialCancelled')) return 'declare';
  return step;
}

/** Dice that land 6 and 5 (a sure success the first time, never snake eyes). */
export function kindDice(): () => number {
  let n = 0;
  return () => (n++ % 2 ? 5 : 6);
}

/** Whether this browser has been offered the lesson already (or taken it). */
const OFFERED_KEY = 'vtc.tutorial.v1';
export function tutorialOffered(storage?: Storage): boolean {
  try {
    return (storage ?? globalThis.localStorage)?.getItem(OFFERED_KEY) !== null;
  } catch {
    return true;
  }
}
export function markTutorialOffered(storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(OFFERED_KEY, String(Date.now()));
  } catch {
    // blocked storage: offered again next time
  }
}
