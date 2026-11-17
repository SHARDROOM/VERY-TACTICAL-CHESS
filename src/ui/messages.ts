import { josa } from './josa';
import { BURN, COVER_NAME, TERRAIN_NAME, clashScore, squareName, type Color, type GameEvent, type Outcome, type PieceType, type RejectReason, type RollModifier, type Tag } from '../engine';

export const COLOR_NAME: Record<Color, string> = { white: '백', black: '흑', red: '적', gray: '회색' };

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
  landingPending: '기물이 떨어지는 중입니다. 잠시 기다려 주세요.',
  nothingFalling: '떨어지는 기물이 없습니다.',
  notChainedPiece: '연속 이동 중입니다. 방금 움직인 기물을 한 번 더 움직이거나 턴을 넘기세요.',
  surrenderPending: '항복한 쪽이 남길 기물을 고르는 중입니다.',
  noSurrender: '항복한 플레이어가 없습니다.',
  notExiledPiece: '항복한 쪽의 기물만 남길 수 있습니다.',
  illegalWander: '떠돌이 기물이 그렇게 움직일 수 없습니다.',
  chainInProgress: '연속 이동 중에는 특수 행동을 할 수 없습니다. 기물을 한 번 더 움직이거나 턴을 넘기세요.',
};

/** How a tag changes its piece's moves, e.g. "룩·비숍처럼 이동, 한 턴에 2번 연속 이동" ('' if nothing). */
export function movePowers(t: { moveAs?: readonly PieceType[]; moveTimes?: number }): string {
  const out: string[] = [];
  if (t.moveAs?.length) out.push(`${t.moveAs.map((k) => PIECE_NAME[k]).join('·')}처럼 이동`);
  if (t.moveTimes && t.moveTimes > 1) out.push(`한 턴에 ${t.moveTimes}번 연속 이동`);
  return out.join(', ');
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  success: '성공!',
  failure: '실패',
  critFailure: '대실패!!',
};

export type LogTone = 'normal' | 'warn' | 'error' | 'gm' | 'roll' | 'chaos' | 'turnbreak';
export interface LogEntry {
  text: string;
  tone: LogTone;
}

/** A clash score as shown: "3×1.5=4.5→5" (rounded half up), "5×1.2=6", or just "4" without a multiplier. */
export function score(roll: number, mult: number): string {
  if (mult === 1) return String(roll);
  const exact = Math.round(roll * mult * 100) / 100;
  const whole = clashScore(roll, mult);
  return `${roll}×${mult}=${exact}${exact === whole ? '' : `→${whole}`}`;
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
        else if (e.cause === 'fall') add(`💥 ${COLOR_NAME[e.piece.color]} ${josa(PIECE_NAME[e.piece.type], '이/가')} 떨어져 산산조각 남`, 'warn');
        else add(`${COLOR_NAME[e.piece.color]} ${PIECE_NAME[e.piece.type]}(${squareName(e.at)}) 제거됨`);
        break;
      case 'tagged': {
        const who = name(e.pieceId);
        const powers = movePowers(e);
        add(`🏷 ${who}(${squareName(e.at)})에 '${e.tag}' ${e.turns === null ? '(영구)' : `(${e.turns}턴)`}${powers ? ` — ${powers}` : ''}`);
        break;
      }
      case 'moveAgain':
        add(`👣 ${josa(name(e.pieceId), '이/가')} 한 번 더 움직일 수 있음 (${e.left}번 남음, 그만두려면 턴 종료)`, 'warn');
        break;
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
      case 'lifted':
        add(`🪶 ${josa(name(e.pieceId), '이/가')} ${squareName(e.from)} 위 공중(${squareName(e.to)})으로 떠오름`);
        break;
      case 'fallStarted':
        add(`⬇ ${squareName(e.at)}의 ${josa(name(e.pieceId), '이/가')} 떨어진다!`, 'warn');
        break;
      case 'fell':
        for (const f of e.falls) {
          if (f.result === 'landed') add(`${josa(name(f.pieceId), '이/가')} ${squareName(f.to!)}에 떨어짐`);
          else if (f.result === 'pushed') add(`${josa(name(f.pieceId), '이/가')} 설 곳을 찾아 ${squareName(f.to!)}에 겨우 내려섬`, 'warn');
        }
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
      case 'surrendered':
        add(`🏳 ${COLOR_NAME[e.loser]}의 킹이 ${COLOR_NAME[e.to]}에게 항복했습니다.`, 'warn');
        if (!e.keepsOne) add(`${COLOR_NAME[e.loser]}에게는 남은 기물이 없어 탈락합니다.`);
        break;
      case 'exiled':
        {
          const name = PIECE_NAME[e.piece.type];
          // The particle follows the piece's name, not the square in brackets after it.
          const particle = josa(name, '이/가').slice(name.length);
          add(`${COLOR_NAME[e.loser]}의 ${name}(${squareName(e.at)})${particle} 누더기 후드를 뒤집어쓰고 망명합니다… 나머지는 모두 ${COLOR_NAME[e.to]}의 지휘를 받습니다.`, 'warn');
        }
        break;
      case 'wandered':
        add(`🚶 떠돌이가 제멋대로 움직입니다: ${squareName(e.from)} → ${squareName(e.to)}`);
        break;
      case 'crowned':
        add(`👑 망명자가 킹을 잡고 ${COLOR_NAME[e.color]}의 새 킹이 되었습니다!`, 'warn');
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
      case 'specialResolved': {
        // The modifiers, each with where it came from: "+2 지휘의 깃발 −1 강철 의지 = 9".
        const mods = e.mods?.length ? ` ${e.mods.map((m) => `${signed(m.value)} ${m.label}`).join(' ')} = ${e.roll + (e.bonus ?? 0)}` : '';
        add(`🎲 ${e.reroll ? `다시 굴림${e.reroll > 1 ? ` ${e.reroll}` : ''}: ` : ''}주사위 ${e.dice ? `${e.dice[0]}+${e.dice[1]}=` : ''}${e.roll}${mods} (DC ${e.dc}) → ${OUTCOME_LABEL[e.outcome]} · AP -${e.cost}`, 'roll');
        if (e.narration) add(e.narration, 'gm');
        break;
      }
    }
  }
  return out;
}

/** "+2", "−1" (a real minus sign). */
export const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${-n}`);

/** Where a roll modifier comes from, in words. */
export const MOD_KIND_NAME: Record<RollModifier['kind'], string> = { skill: '특기', mind: '정신력', sacrifice: '희생', remains: '유해' };

/** A tag's skill and will in words, e.g. "특기: 함께 전진하는 행동 +2", "정신력 +2". */
export function mindAndSkill(t: Tag): string {
  const out: string[] = [];
  if (t.skill) out.push(`특기: ${t.skill.about} ${signed(t.skill.bonus)}`);
  if (t.mind) out.push(`정신력 ${signed(t.mind)}`);
  return out.join(', ');
}
