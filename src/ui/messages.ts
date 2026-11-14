import { josa } from './josa';
import { squareName, type Color, type GameEvent, type PieceType, type RejectReason } from '../engine';

export const COLOR_NAME: Record<Color, string> = { white: '백', black: '흑' };

export const PIECE_NAME: Record<PieceType, string> = {
  king: '킹', queen: '퀸', rook: '룩', bishop: '비숍', knight: '나이트', pawn: '폰',
};

export const REJECT_MESSAGE: Record<RejectReason, string> = {
  gameOver: '게임이 이미 끝났습니다.',
  noPiece: '그 칸에는 기물이 없습니다.',
  notYourPiece: '지금은 상대의 기물을 움직일 수 없습니다.',
  illegalMove: '그 기물은 그 칸으로 갈 수 없습니다.',
  promotionRequired: '프로모션할 기물을 골라야 합니다. 예: e7e8q',
  invalidPromotion: '그 수에는 그 프로모션을 할 수 없습니다.',
  actionPending: '먼저 GM의 판정을 시도하거나 취소하세요.',
  noPendingAction: '진행 중인 특수 행동이 없습니다.',
  emptyAction: '행동을 입력하세요.',
  actionTooLong: '특수 행동은 200자까지 입력할 수 있습니다.',
  invalidRuling: 'GM의 판정이 규칙에 맞지 않아 거부되었습니다. AP는 쓰지 않았습니다.',
  notFeasible: 'GM이 불가능하다고 판정한 행동입니다.',
  notEnoughAp: 'AP가 부족합니다.',
  invalidRoll: '주사위 값이 올바르지 않습니다.',
};

export type LogTone = 'normal' | 'warn' | 'error' | 'gm' | 'roll';
export interface LogEntry {
  text: string;
  tone: LogTone;
}

/** Log lines for the events of one command. `pieceType` resolves a moved piece's name. */
export function describeEvents(events: GameEvent[], pieceType: (id: string) => PieceType | undefined): LogEntry[] {
  const out: LogEntry[] = [];
  const add = (text: string, tone: LogTone = 'normal') => out.push({ text, tone });
  for (const e of events) {
    switch (e.type) {
      case 'moved': {
        const type = pieceType(e.pieceId);
        const who = type ? PIECE_NAME[type] : '기물';
        const cap = e.captured ? ` — ${COLOR_NAME[e.captured.color]} ${josa(PIECE_NAME[e.captured.type], '을/를')} 잡음` : '';
        let extra = '';
        if (e.special?.kind === 'castle') extra = e.special.side === 'king' ? ' (킹사이드 캐슬링)' : ' (퀸사이드 캐슬링)';
        if (e.special?.kind === 'enPassant') extra = ' (앙파상)';
        if (e.special?.kind === 'promotion') extra = ` — ${josa(PIECE_NAME[e.special.to], '으로/로')} 프로모션`;
        add(`${who} ${squareName(e.from)} → ${squareName(e.to)}${cap}${extra}`);
        break;
      }
      case 'removed':
        add(`${COLOR_NAME[e.piece.color]} ${PIECE_NAME[e.piece.type]}(${squareName(e.at)}) 제거됨`);
        break;
      case 'check':
        add(`체크! ${COLOR_NAME[e.color]} 킹이 공격받고 있습니다.`, 'warn');
        break;
      case 'ownKingExposed':
        add(`⚠ 경고: ${COLOR_NAME[e.color]} 킹이 공격받는 위치에 남아 있습니다.`, 'warn');
        break;
      case 'kingCaptured':
        add(`👑 킹을 잡았습니다! ${COLOR_NAME[e.winner]} 승리.`);
        break;
      case 'turnPassed':
        add(`— ${COLOR_NAME[e.turn]}의 차례 (AP +${e.apGained}) —`);
        break;
      case 'specialProposed':
        add(`📜 ${COLOR_NAME[e.color]}: "${e.action}"`);
        add(
          e.ruling.feasible
            ? `GM: ${e.ruling.interpretation} (DC ${e.ruling.dc}, AP ${e.ruling.cost})`
            : `GM: 불가능 — ${e.ruling.interpretation}`,
          'gm',
        );
        break;
      case 'specialCancelled':
        add(`${josa(COLOR_NAME[e.color], '이/가')} 행동을 취소했습니다.`);
        break;
      case 'specialResolved':
        add(`🎲 d20 = ${e.roll} (DC ${e.dc}) → ${e.success ? '성공!' : '실패'} · AP -${e.cost}`, 'roll');
        if (e.narration) add(e.narration, 'gm');
        break;
    }
  }
  return out;
}
