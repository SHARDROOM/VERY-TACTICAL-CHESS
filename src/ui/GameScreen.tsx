import { Suspense, lazy, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  findKing,
  isInCheck,
  legalTargets,
  opponent,
  parseMoveText,
  rankOf,
  type Color,
  type GameEvent,
  type GameState,
  type Outcome,
  type Piece,
  type PromotionType,
  type Square,
} from '../engine';
import { BoardScene, type CameraRequest } from '../scene/BoardScene';
import { COLOR_NAME, OUTCOME_LABEL, PIECE_NAME, REJECT_MESSAGE, describeEvents, type LogEntry, type LogTone } from './messages';
import { PrecedentList } from './PrecedentList';
import { GmSettings, type GmConfig } from './GmSettings';
import { PieceInfo } from './PieceInfo';
import { successChance } from '../dice';
import { PROVIDER_LABEL } from '../gm/createGm';
import type { Session, SessionView } from '../session/types';

interface LogLine extends LogEntry {
  id: number;
}

/** One batch of game events from the session, shown on screen in order. */
interface Batch {
  events: GameEvent[];
  before: GameState;
  after: GameState;
  /** The dice for this batch have already been shown. */
  rolled: boolean;
}

// Physics and the dice scene load only when the first roll happens.
const DiceOverlay = lazy(() => import('../dice3d/DiceOverlay'));

const DICE_PREF = 'vtc.dice3d';
function readDicePref(): boolean {
  try {
    return localStorage.getItem(DICE_PREF) !== 'off';
  } catch {
    return true;
  }
}
function writeDicePref(on: boolean) {
  try {
    localStorage.setItem(DICE_PREF, on ? 'on' : 'off');
  } catch {
    // a remembered preference is only a convenience
  }
}

let nextLogId = 1;

/** A piece on the board or riding on one. */
function findPiece(board: GameState['board'], id: string): Piece | undefined {
  for (const p of board) {
    if (p?.id === id) return p;
    if (p?.rider?.id === id) return p.rider;
  }
  return undefined;
}

function ApMeter({ color, ap, max, active }: { color: Color; ap: number; max: number; active: boolean }) {
  return (
    <div className={`ap ${active ? 'active' : ''}`} title={`${COLOR_NAME[color]} AP ${ap}/${max}`}>
      <span className="ap-label">{COLOR_NAME[color]} AP</span>
      <span className="ap-pips">
        {Array.from({ length: max }, (_, i) => (
          <span key={i} className={`pip ${i < ap ? 'full' : ''}`} />
        ))}
      </span>
      <span className="ap-num">{ap}</span>
    </div>
  );
}

interface Props {
  session: Session;
  gmConfig: GmConfig;
  onGmConfig: (config: GmConfig) => void;
  onLeave: () => void;
  /** Open the GM settings right away (a resumed game whose API key must be typed again). */
  openGmSettings?: boolean;
  /** A line to show in the log when the screen opens. */
  startNotice?: string | null;
}

export function GameScreen({ session, gmConfig, onGmConfig, onLeave, openGmSettings = false, startNotice = null }: Props) {
  const [view, setView] = useState<SessionView>(() => session.view());
  const seat = view.seat;
  const online = view.connection.kind !== 'local';
  const homeSide: Color = seat === 'both' ? 'white' : seat;

  const [selected, setSelected] = useState<Square | null>(null);
  const [hovered, setHovered] = useState<Square | null>(null);
  const [log, setLog] = useState<LogLine[]>(() => (startNotice ? [{ id: nextLogId++, text: startNotice, tone: 'warn' }] : []));
  const [text, setText] = useState('');
  const [camera, setCamera] = useState<CameraRequest>({ mode: 'side', side: homeSide, nonce: 0 });
  const [warning, setWarning] = useState<string | null>(null);
  const [lastRoll, setLastRoll] = useState<{ roll: number; outcome: Outcome } | null>(null);
  const [showPrecedents, setShowPrecedents] = useState(false);
  const [showGmSettings, setShowGmSettings] = useState(openGmSettings);
  const [promotionChoice, setPromotionChoice] = useState<{ from: Square; to: Square } | null>(null);
  const [copied, setCopied] = useState(false);
  /** The dice roll being shown, and the board as it was before it (shown until the dice land). */
  const [dice, setDice] = useState<{ roll: number; outcome: Outcome; done: () => void } | null>(null);
  const [frozen, setFrozen] = useState<GameState | null>(null);
  const queueRef = useRef<Batch[]>([]);
  const [diceEnabled, setDiceEnabled] = useState(() => readDicePref());
  const diceEnabledRef = useRef(diceEnabled);
  diceEnabledRef.current = diceEnabled;
  const logRef = useRef<HTMLOListElement>(null);

  const addLog = (entries: LogEntry[]) => setLog((l) => [...l, ...entries.map((e) => ({ ...e, id: nextLogId++ }))]);
  const say = (t: string, tone: LogTone = 'normal') => addLog([{ text: t, tone }]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Warm up the dice physics in the background so the first roll starts at once.
  useEffect(() => {
    if (!diceEnabled) return;
    const t = setTimeout(() => {
      void import('../dice3d/simulate').then((m) => m.loadPhysics()).catch(() => {});
      void import('../dice3d/DiceOverlay').catch(() => {});
    }, 2500);
    return () => clearTimeout(t);
  }, [diceEnabled]);

  // Online, the camera stays on your side once your color is known.
  useEffect(() => {
    if (seat !== 'both') setCamera((c) => ({ ...c, side: seat, nonce: c.nonce + 1 }));
  }, [seat]);

  useEffect(() => {
    /** Logs a batch of game events and reacts to them (the moment the board shows them). */
    const applyBatch = ({ events, before, after }: Batch) => {
      const typeOf = (id: string) => findPiece(before.board, id)?.type ?? findPiece(after.board, id)?.type;
      addLog(describeEvents(events, typeOf));
      const passed = events.some((ev) => ev.type === 'turnPassed');
      const exposed = events.find((ev) => ev.type === 'ownKingExposed');
      if (exposed) setWarning(`${COLOR_NAME[exposed.color]} 킹이 공격받는 위치에 놓였습니다.`);
      else if (passed) setWarning(null);
      const resolved = events.find((ev) => ev.type === 'specialResolved');
      if (resolved) setLastRoll({ roll: resolved.roll, outcome: resolved.outcome });
      else if (passed) setLastRoll(null);
      const proposed = events.find((ev) => ev.type === 'specialProposed');
      if (proposed && (seat === 'both' || proposed.color === seat)) setText('');
      setSelected(null);
      if (seat === 'both' && after.status.kind === 'playing' && after.turn !== before.turn) {
        // Hotseat: swing the camera to the player whose turn it is.
        setCamera((c) => ({ ...c, side: after.turn, nonce: c.nonce + 1 }));
      }
    };

    /**
     * Shows queued batches in order. A batch with a dice roll first plays the roll while the
     * board keeps showing the position before it; the rest waits behind it.
     */
    const pump = () => {
      const queue = queueRef.current;
      while (queue.length) {
        const head = queue[0];
        const resolved = head.events.find((ev) => ev.type === 'specialResolved');
        if (resolved && !head.rolled && diceEnabledRef.current) {
          head.rolled = true;
          setFrozen(head.before);
          setDice({ roll: resolved.roll, outcome: resolved.outcome, done: () => {
            setDice(null);
            pump();
          } });
          return;
        }
        queue.shift();
        applyBatch(head);
      }
      setFrozen(null);
    };

    const unsubscribe = session.subscribe((e) => {
      if (e.kind === 'view') {
        setView(e.view);
        return;
      }
      if (e.kind === 'notice') {
        say(e.text, e.tone === 'normal' ? 'normal' : e.tone);
        return;
      }
      queueRef.current.push({ events: e.events, before: e.before, after: e.after, rolled: false });
      // While a roll is on screen, later batches wait their turn.
      if (queueRef.current.length === 1) pump();
    });
    // Anything that arrived between the first render and this subscription (e.g. the host's welcome).
    setView(session.view());
    return unsubscribe;
  }, [session, seat]);

  const game = frozen ?? view.state;
  const targets = useMemo(() => (selected === null ? [] : legalTargets(game, selected).map((t) => t.to)), [game, selected]);

  const sideToMove = game.turn;
  const playing = game.status.kind === 'playing';
  const myTurn = seat === 'both' || seat === sideToMove;
  const inCheck = playing && isInCheck(game.board, sideToMove);
  const checkedKing = inCheck ? findKing(game.board, sideToMove) : null;
  const pending = game.pending;
  const connected = view.connection.kind === 'local' || view.connection.kind === 'connected';
  const locked = !playing || view.gmBusy || !!pending || !myTurn || !connected || !!dice;
  const winner = game.status.kind === 'won' ? game.status.winner : null;

  const promotes = (from: Square, to: Square) => {
    const mover = game.board[from];
    return mover?.type === 'pawn' && rankOf(to) === (mover.color === 'white' ? 7 : 0);
  };

  const onSquareClick = (sq: Square) => {
    if (locked) return;
    const piece = game.board[sq];
    if (selected !== null && targets.includes(sq)) {
      if (promotes(selected, sq)) setPromotionChoice({ from: selected, to: sq });
      else session.request({ type: 'move', from: selected, to: sq });
      setSelected(null);
      return;
    }
    if (piece && piece.color === sideToMove) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = text.trim();
    if (!input || locked) return;
    const parsed = parseMoveText(input);
    if (parsed) {
      if (!parsed.promotion && promotes(parsed.from, parsed.to) && legalTargets(game, parsed.from).some((t) => t.to === parsed.to)) {
        setPromotionChoice({ from: parsed.from, to: parsed.to });
      } else {
        session.request({ type: 'move', ...parsed });
      }
      setText('');
      return;
    }
    if (input.length > game.rules.actionMaxLength) {
      say(REJECT_MESSAGE.actionTooLong, 'error');
      return;
    }
    // The text stays in the box until the GM's ruling arrives, so a failed call can be resent.
    session.request({ type: 'declare', action: input });
  };

  const promote = (type: PromotionType) => {
    if (!promotionChoice) return;
    session.request({ type: 'move', ...promotionChoice, promotion: type });
    setPromotionChoice(null);
  };

  const restart = () => {
    setLog([]);
    setWarning(null);
    setLastRoll(null);
    setSelected(null);
    session.restart();
    setCamera((c) => ({ mode: 'side', side: seat === 'both' ? 'white' : seat, nonce: c.nonce + 1 }));
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be blocked; the link is visible to copy by hand.
    }
  };

  const canAfford = pending ? game.ap[pending.color] >= pending.ruling.cost : false;
  const canActOnPending = !!pending && (seat === 'both' || seat === pending.color) && connected;
  const conn = view.connection;

  const placeholder = winner
    ? '게임 종료'
    : !connected
      ? '연결을 기다리는 중'
      : !myTurn
        ? `${COLOR_NAME[sideToMove]}의 차례입니다`
        : `${COLOR_NAME[sideToMove]}: 수 또는 특수 행동`;

  return (
    <div className="app">
      <BoardScene
        board={game.board}
        selected={selected}
        targets={targets}
        checkedKing={checkedKing}
        camera={camera}
        onSquareClick={onSquareClick}
        onHoverSquare={setHovered}
      />

      <div className="hud topbar">
      <header className="top">
        <div className={`turn turn-${sideToMove}`}>
          {winner ? `${COLOR_NAME[winner]} 승리!` : `${COLOR_NAME[sideToMove]}의 차례`}
          <span className="turn-number">턴 {game.turnNumber}</span>
        </div>
        {seat !== 'both' && <div className={`badge me me-${seat}`}>나: {COLOR_NAME[seat]}</div>}
        <ApMeter color="white" ap={game.ap.white} max={game.rules.apMax} active={sideToMove === 'white'} />
        <ApMeter color="black" ap={game.ap.black} max={game.rules.apMax} active={sideToMove === 'black'} />
        {inCheck && <div className="badge check">체크!</div>}
        {view.gmBusy && <div className="badge busy">GM 판정 중…</div>}
        {lastRoll && (
          <div className={`badge roll ${lastRoll.outcome}`}>
            🎲 {lastRoll.roll} — {OUTCOME_LABEL[lastRoll.outcome]}
          </div>
        )}
        {warning && !winner && <div className="badge warn">⚠ {warning}</div>}
        {conn.kind === 'waiting' && conn.guestLeft && <div className="badge warn">상대 연결 끊김 · 재접속 대기 중 (코드 {conn.code})</div>}
      </header>


      <div className="camera-buttons">
        <button onClick={() => setShowPrecedents(true)} title="이번 게임의 판례">
          📜 판례 {game.precedents.length}
        </button>
        {view.isAuthority ? (
          <button onClick={() => setShowGmSettings(true)} disabled={view.gmBusy} title="GM 설정">
            ⚙ {PROVIDER_LABEL[gmConfig.provider]}
          </button>
        ) : (
          <button disabled title="GM은 방장이 설정합니다">🎙 {view.gmName || 'GM'}</button>
        )}
        <button
          onClick={() => {
            setDiceEnabled((on) => {
              writeDicePref(!on);
              return !on;
            });
          }}
          title="특수 행동 주사위를 3D로 굴릴지"
        >
          🎲 {diceEnabled ? '3D 주사위 켬' : '3D 주사위 끔'}
        </button>
        <button onClick={() => setCamera((c) => ({ mode: 'side', side: seat === 'both' ? sideToMove : seat, nonce: c.nonce + 1 }))}>
          시점 초기화
        </button>
        <button onClick={() => setCamera((c) => ({ ...c, mode: c.mode === 'top' ? 'side' : 'top', nonce: c.nonce + 1 }))}>
          {camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'}
        </button>
        <button onClick={onLeave} title="로비로 나가기">나가기</button>
      </div>
      </div>

      {(() => {
        const sq = hovered ?? selected;
        const piece = sq === null ? null : game.board[sq];
        return piece ? <PieceInfo piece={piece} square={sq!} /> : null;
      })()}

      <aside className="hud panel">
        <ol className="log" ref={logRef}>
          {log.length === 0 && (
            <li className="hint">
              기물을 클릭하거나 수를 입력하세요 (예: e2e4). 규칙 밖의 행동은 그대로 문장으로 쓰면 GM이 판정합니다.
              <br />
              지금 GM: {view.gmName}.{' '}
              {view.isAuthority
                ? '진짜 GM은 ⚙ 버튼에서 Claude, OpenAI, Gemini 중 하나의 API 키를 넣으면 켜집니다.'
                : 'GM은 방장이 설정합니다.'}
            </li>
          )}
          {log.map((l) => (
            <li key={l.id} className={l.tone}>
              {l.text}
            </li>
          ))}
        </ol>
        <form onSubmit={onSubmit} className="input-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            disabled={locked}
            maxLength={game.rules.actionMaxLength}
          />
          <button type="submit" disabled={locked || !text.trim()}>
            입력
          </button>
        </form>
        <div className="panel-footer">
          <span className="counter">
            {text.length}/{game.rules.actionMaxLength}
          </span>
          <button onClick={() => session.request({ type: 'endTurn' })} disabled={locked}>
            턴 종료
          </button>
        </div>
      </aside>

      {pending && !dice && (
        <div className="overlay">
          <div className="dialog ruling">
            <div className="ruling-who">{COLOR_NAME[pending.color]}의 특수 행동</div>
            <blockquote>"{pending.action}"</blockquote>
            <h2>GM 판정</h2>
            <p>{pending.ruling.interpretation}</p>
            {pending.ruling.feasible ? (
              <dl className="ruling-stats">
                <div>
                  <dt>난이도</dt>
                  <dd>DC {pending.ruling.dc}</dd>
                </div>
                <div>
                  <dt>비용</dt>
                  <dd>
                    AP {pending.ruling.cost} <small>(보유 {game.ap[pending.color]})</small>
                  </dd>
                </div>
                <div>
                  <dt>성공 확률</dt>
                  <dd>{Math.round(successChance(pending.ruling.dc) * 100)}%</dd>
                </div>
              </dl>
            ) : (
              <p className="infeasible">GM이 불가능한 행동으로 판정했습니다.</p>
            )}
            {pending.ruling.feasible && (
              <ul className="crit-notes">
                <li>
                  🎲 20: 대성공{pending.ruling.critSuccessEffects?.length ? ' — 더 좋은 결과' : ' — 성공과 같은 결과'} (DC와 상관없이 성공)
                </li>
                <li>
                  🎲 1: 대실패{pending.ruling.critFailureEffects?.length ? ' — ⚠ 역효과가 있습니다' : ''} (DC와 상관없이 실패)
                </li>
              </ul>
            )}
            {pending.ruling.feasible && !canAfford && <p className="infeasible">AP가 부족해서 시도할 수 없습니다.</p>}
            {canActOnPending ? (
              <div className="choice-row">
                <button className="primary" onClick={() => session.request({ type: 'attempt' })} disabled={!pending.ruling.feasible || !canAfford}>
                  🎲 시도
                </button>
                <button onClick={() => session.request({ type: 'cancel' })}>취소 (AP 사용 안 함)</button>
              </div>
            ) : (
              <p className="muted-line">상대가 시도할지 정하는 중입니다…</p>
            )}
          </div>
        </div>
      )}

      {showPrecedents && <PrecedentList precedents={game.precedents} onClose={() => setShowPrecedents(false)} />}

      {showGmSettings && (
        <GmSettings
          current={gmConfig}
          onClose={() => setShowGmSettings(false)}
          onSave={(config) => {
            onGmConfig(config);
            setShowGmSettings(false);
          }}
        />
      )}

      {promotionChoice && (
        <div className="overlay">
          <div className="dialog">
            <h2>프로모션</h2>
            <p>폰을 무엇으로 바꿀까요?</p>
            <div className="choice-row">
              {(['queen', 'rook', 'bishop', 'knight'] as const).map((t) => (
                <button key={t} onClick={() => promote(t)}>
                  {PIECE_NAME[t]}
                </button>
              ))}
            </div>
            <button className="link" onClick={() => setPromotionChoice(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {conn.kind === 'waiting' && !conn.guestLeft && (
        <div className="overlay">
          <div className="dialog invite">
            <h2>친구를 기다리는 중</h2>
            <p>친구에게 방 코드나 초대 링크를 보내 주세요. 친구가 들어오면 바로 시작합니다. 당신은 백입니다.</p>
            <div className="room-code">{conn.code}</div>
            <div className="link-row">
              <input readOnly value={conn.link} onFocus={(e) => e.target.select()} />
              <button onClick={() => copyLink(conn.link)}>{copied ? '복사됨' : '링크 복사'}</button>
            </div>
            <p className="muted-line">기다리는 동안 ⚙ 버튼으로 GM을 설정할 수 있습니다. API 키는 이 브라우저에만 있고 친구에게 전송되지 않습니다.</p>
            <div className="choice-row">
              <button onClick={() => setShowGmSettings(true)}>⚙ GM 설정</button>
              <button onClick={onLeave}>방 닫기</button>
            </div>
          </div>
        </div>
      )}

      {conn.kind === 'paused' && (
        <div className="overlay">
          <div className="dialog">
            <h2>게임 일시정지</h2>
            <p>{conn.reason} 방장이 돌아오면 자동으로 이어집니다.</p>
            <p className="muted-line">다시 연결을 시도하고 있습니다…</p>
            <button onClick={onLeave}>나가기</button>
          </div>
        </div>
      )}

      {conn.kind === 'connecting' && (
        <div className="overlay">
          <div className="dialog">
            <h2>방에 들어가는 중…</h2>
            <p className="muted-line">방장의 응답을 기다리고 있습니다.</p>
            <button onClick={onLeave}>취소</button>
          </div>
        </div>
      )}

      {conn.kind === 'disconnected' && (
        <div className="overlay">
          <div className="dialog">
            <h2>연결이 끊겼습니다</h2>
            <p>{conn.reason}</p>
            <button className="primary" onClick={onLeave}>
              로비로
            </button>
          </div>
        </div>
      )}

      {dice && (
        <Suspense fallback={null}>
          <DiceOverlay roll={dice.roll} outcome={dice.outcome} onDone={dice.done} />
        </Suspense>
      )}

      {winner && connected && !dice && (
        <div className="overlay">
          <div className="victory">
            <h1>{COLOR_NAME[winner]} 승리</h1>
            <p>{COLOR_NAME[opponent(winner)]} 킹이 잡혔습니다.</p>
            {view.isAuthority ? (
              <button onClick={restart}>새 게임</button>
            ) : (
              <p className="muted-line">방장이 새 게임을 시작할 수 있습니다.</p>
            )}
            {online && (
              <button className="link" onClick={onLeave}>
                나가기
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
