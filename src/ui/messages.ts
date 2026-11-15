import { josa } from './josa';
import { BURN, COVER_NAME, TERRAIN_NAME, squareName, type Color, type GameEvent, type Outcome, type PieceType, type RejectReason } from '../engine';

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
  kingProtectedThisTurn: '이번 턴에 AP를 썼으므로 킹을 잡을 수 없습니다.',
  nothingDoneThisTurn: '아무것도 하지 않고는 턴을 끝낼 수 없습니다. 수를 두거나 특수 행동을 시도해 주세요.',
  invalidChaos: '혼돈이 규칙에 맞지 않아 일어나지 않았습니다.',
  clashRollsNeeded: '합 주사위가 없어 처리할 수 없습니다.',
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
  critSuccess: '대성공!!',
  success: '성공!',
  failure: '실패',
  critFailure: '대실패!!',
};

export type LogTone = 'normal' | 'warn' | 'error' | 'gm' | 'roll' | 'chaos' | 'turnbreak';
export interface LogEntry {
  text: string;
  tone: LogTone;
}

/** A clash score as shown: "9×1.5=13.5", or just "12" without a multiplier. */
export function score(roll: number, mult: number): string {
  return mult === 1 ? String(roll) : `${roll}×${mult}=${Math.round(roll * mult * 100) / 100}`;
}

/** Log lines for the events of one command. `pieceType` resolves a moved piece's name. */
export function describeEvents(events: GameEvent[], pieceType: (id: string) => PieceType | undefined): LogEntry[] {
  const out: LogEntry[] = [];
  const add = (text: string, tone: LogTone = 'normal') => out.push({ text, tone });
  const name = (id: string) => {
    const t = pieceType(id);
    return t ? PIECE_NAME[t] : '기물';
  };
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
        if (e.cause === 'burn') add(`🔥 ${squareName(e.at)}의 ${COLOR_NAME[e.piece.color]} ${josa(PIECE_NAME[e.piece.type], '이/가')} 끝내 불타 재가 됨`, 'warn');
        else if (e.cause === 'pit') add(`🕳 ${COLOR_NAME[e.piece.color]} ${josa(PIECE_NAME[e.piece.type], '이/가')} ${squareName(e.at)}의 구덩이에 빠짐`);
        else if (e.cause === 'clash') break; // told with the clash
        else add(`${COLOR_NAME[e.piece.color]} ${PIECE_NAME[e.piece.type]}(${squareName(e.at)}) 제거됨`);
        break;
      case 'tagged': {
        const who = name(e.pieceId);
        add(`🏷 ${who}(${squareName(e.at)})에 '${e.tag}' ${e.turns === null ? '(영구)' : `(${e.turns}턴)`}`);
        break;
      }
      case 'untagged':
        if (e.tag === BURN) add(`💨 ${josa(name(e.pieceId), '이/가')} ${josa(squareName(e.at), '으로/로')} 움직여 불이 꺼짐`);
        else add(`${name(e.pieceId)}(${squareName(e.at)})의 '${e.tag}' 태그가 사라짐`);
        break;
      case 'tagExpired':
        add(`⌛ ${name(e.pieceId)}의 '${e.tag}' 효과가 끝남`);
        break;
      case 'boarded':
        add(`🐎 ${josa(name(e.riderId), '이/가')} ${squareName(e.at)}의 ${name(e.carrierId)}에 올라탐`);
        break;
      case 'unboarded':
        add(`${josa(name(e.riderId), '이/가')} ${squareName(e.from)}에서 ${josa(squareName(e.to), '으로/로')} 내림`);
        break;
      case 'transformed':
        add(`✨ ${squareName(e.at)}의 ${josa(PIECE_NAME[e.from], '이/가')} ${josa(PIECE_NAME[e.to], '으로/로')} 변함`);
        break;
      case 'spawned':
        add(`✨ ${squareName(e.at)}에 ${COLOR_NAME[e.piece.color]} ${PIECE_NAME[e.piece.type]} 등장`);
        break;
      case 'converted':
        add(`🎭 ${squareName(e.at)}의 ${josa(name(e.pieceId), '이/가')} ${COLOR_NAME[e.to]} 편이 됨`, 'warn');
        break;
      case 'clash': {
        const rounds = e.rounds.map((r) => `${score(r.attack, e.attack)} 대 ${score(r.defense, e.defense)}`).join(', 동점 → ');
        add(`⚔ 합! ${name(e.attackerId)}(${squareName(e.from)}) ×${e.attack} 대 ${name(e.defenderId)}(${squareName(e.at)}) ×${e.defense}: ${rounds}`, 'roll');
        add(
          e.winner === 'attacker'
            ? e.shield
              ? `${josa(name(e.attackerId), '이/가')} 이겨 보호막을 깨뜨렸다`
              : `${josa(name(e.attackerId), '이/가')} 합에서 이겼다`
            : `${josa(name(e.defenderId), '이/가')} 버텨 냈다. 공격한 ${josa(name(e.attackerId), '이/가')} 쓰러짐`,
          e.winner === 'attacker' ? 'normal' : 'warn',
        );
        break;
      }
      case 'swapped':
        add(`🔄 ${squareName(e.a)}의 ${josa(name(e.aId), '와/과')} ${squareName(e.b)}의 ${josa(name(e.bId), '이/가')} 자리를 맞바꿈`);
        break;
      case 'revived':
        add(`🕯 ${COLOR_NAME[e.piece.color]} ${josa(PIECE_NAME[e.piece.type], '이/가')} ${squareName(e.at)}에 되살아남`);
        break;
      case 'terrainMade':
        add(`${e.kind === 'wall' ? '🧱' : '🕳'} ${squareName(e.at)}에 ${TERRAIN_NAME[e.kind]} ${e.turns === null ? '(영구)' : `(${e.turns}턴)`}`);
        break;
      case 'terrainCleared':
        add(e.expired ? `⌛ ${squareName(e.at)}의 ${josa(TERRAIN_NAME[e.kind], '이/가')} 사라짐` : `${squareName(e.at)}의 ${josa(TERRAIN_NAME[e.kind], '이/가')} 없어짐`);
        break;
      case 'coverMade':
        add(`${e.kind === 'bridge' ? '🌉' : '🪜'} ${squareName(e.at)}에 ${COVER_NAME[e.kind]} ${e.turns === null ? '(영구)' : `(${e.turns}턴)`}`);
        break;
      case 'coverGone':
        add(e.expired ? `⌛ ${squareName(e.at)}의 ${josa(COVER_NAME[e.kind], '이/가')} 사라짐` : `${squareName(e.at)}의 ${josa(COVER_NAME[e.kind], '이/가')} 없어짐`);
        break;
      case 'pushed':
        add(`${josa(name(e.pieceId), '이/가')} 무너지는 다리에서 ${josa(squareName(e.to), '으로/로')} 비켜남`, 'warn');
        break;
      case 'timedOut':
        add(`⏰ ${COLOR_NAME[e.color]}의 시간이 다 되었습니다.${e.apLost ? ` AP ${e.apLost} 차감.` : ''} 턴이 넘어갑니다.`, 'warn');
        break;
      case 'chaos':
        add(`🌪 혼돈! ${e.title}`, 'chaos');
        add(e.narration, 'gm');
        break;
      case 'shieldBroken':
        add(`🛡 ${name(e.pieceId)}(${squareName(e.at)})의 보호막이 공격을 막고 깨짐`, 'warn');
        break;
      case 'autoTurnEnd':
        add(`⏭ 특수 행동 뒤 상대 킹이 공격받고 있어 ${COLOR_NAME[e.color]}의 턴이 자동으로 끝났습니다. (남은 AP는 다음 턴으로 이월)`, 'warn');
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
        add(`${COLOR_NAME[e.turn]}의 차례 (AP +${e.apGained})`, 'turnbreak');
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
        add(e.afterFailure ? `${josa(COLOR_NAME[e.color], '은/는')} 다시 굴리지 않았습니다.` : `${josa(COLOR_NAME[e.color], '이/가')} 행동을 취소했습니다.`);
        break;
      case 'specialResolved':
        add(`🎲 ${e.reroll ? `다시 굴림${e.reroll > 1 ? ` ${e.reroll}` : ''}: ` : ''}d20 = ${e.roll} (DC ${e.dc}) → ${OUTCOME_LABEL[e.outcome]} · AP -${e.cost}`, 'roll');
        if (e.narration) add(e.narration, 'gm');
        break;
    }
  }
  return out;
}
