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
};

/** Log lines for the events of one command. `pieceType` resolves the moved piece's name. */
export function describeEvents(events: GameEvent[], pieceType: (id: string) => PieceType | undefined): string[] {
  const out: string[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'moved': {
        const type = pieceType(e.pieceId);
        const who = type ? PIECE_NAME[type] : '기물';
        const cap = e.captured ? ` — ${COLOR_NAME[e.captured.color]} ${PIECE_NAME[e.captured.type]}을(를) 잡음` : '';
        let extra = '';
        if (e.special?.kind === 'castle') extra = e.special.side === 'king' ? ' (킹사이드 캐슬링)' : ' (퀸사이드 캐슬링)';
        if (e.special?.kind === 'enPassant') extra = ' (앙파상)';
        if (e.special?.kind === 'promotion') extra = ` — ${PIECE_NAME[e.special.to]}(으)로 프로모션`;
        out.push(`${who} ${squareName(e.from)} → ${squareName(e.to)}${cap}${extra}`);
        break;
      }
      case 'check':
        out.push(`체크! ${COLOR_NAME[e.color]} 킹이 공격받고 있습니다.`);
        break;
      case 'ownKingExposed':
        out.push(`⚠ 경고: ${COLOR_NAME[e.color]} 킹이 공격받는 위치에 남아 있습니다.`);
        break;
      case 'kingCaptured':
        out.push(`👑 킹을 잡았습니다! ${COLOR_NAME[e.winner]} 승리.`);
        break;
      case 'turnPassed':
        break;
    }
  }
  return out;
}
