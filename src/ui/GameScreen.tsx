import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Quaternion } from 'three';
import {
  findKing,
  hasAnyMove,
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
import { SettingsMenu, useFullscreen } from './SettingsMenu';
import { playSfx } from '../audio/sfx';
import { successChance } from '../dice';
import { loadPhysics, simulateRoll } from '../dice3d/simulate';
import { skinRotationFor } from '../dice3d/d20';
import type { ActiveRoll } from '../dice3d/DiceTray';
import { CHAT_MAX_LENGTH, timeLeft, type Session, type SessionView, type TurnTimer } from '../session/types';
import { ConnectionOverlay } from './ConnectionOverlay';
import { clockText, rulesSummary } from './rules';

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

let nextLogId = 1;

/** A piece on the board or riding on one. */
function findPiece(board: GameState['board'], id: string): Piece | undefined {
  for (const p of board) {
    if (p?.id === id) return p;
    if (p?.rider?.id === id) return p.rider;
  }
  return undefined;
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
  const homeSide: Color = seat === 'black' ? 'black' : 'white';
  const spectator = seat === 'spectator';

  const [selected, setSelected] = useState<Square | null>(null);
  const [hovered, setHovered] = useState<Square | null>(null);
  const [log, setLog] = useState<LogLine[]>(() => (startNotice ? [{ id: nextLogId++, text: startNotice, tone: 'warn' }] : []));
  const [text, setText] = useState('');
  const [camera, setCamera] = useState<CameraRequest>({ mode: 'side', side: homeSide, nonce: 0 });
  const [warning, setWarning] = useState<string | null>(null);
  const [showPrecedents, setShowPrecedents] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const fullscreen = useFullscreen();
  const [showGmSettings, setShowGmSettings] = useState(openGmSettings);
  const [promotionChoice, setPromotionChoice] = useState<{ from: Square; to: Square } | null>(null);
  const [tab, setTab] = useState<'log' | 'chat'>('log');
  // A folded panel keeps only the input row, leaving the table in view.
  const [collapsed, setCollapsed] = useState(false);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const chat = view.chat;
  const [chatText, setChatText] = useState('');
  /** A chaos event being announced across the screen. */
  const [chaosBanner, setChaosBanner] = useState<{ title: string; narration: string } | null>(null);
  const [unread, setUnread] = useState(0);
  const chatRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat.length, tab]);
  useEffect(() => {
    if (!chaosBanner) return;
    const t = setTimeout(() => setChaosBanner(null), 5000);
    return () => clearTimeout(t);
  }, [chaosBanner]);
  /**
   * The roll being shown on the table, and the board as it was before it (kept on screen
   * until the die lands). `landed` flips when the die stops; `done` reveals the result.
   */
  const [dice, setDice] = useState<{ roll: number; outcome: Outcome; done: () => void; landed: boolean } | null>(null);
  const [diceRoll, setDiceRoll] = useState<ActiveRoll | null>(null);
  const [frozen, setFrozen] = useState<GameState | null>(null);
  const queueRef = useRef<Batch[]>([]);
  const cameraBeforeDice = useRef<CameraRequest | null>(null);
  const logRef = useRef<HTMLOListElement>(null);

  const addLog = (entries: LogEntry[]) => setLog((l) => [...l, ...entries.map((e) => ({ ...e, id: nextLogId++ }))]);
  const say = (t: string, tone: LogTone = 'normal') => addLog([{ text: t, tone }]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);

  // Warm up the dice physics in the background so the first roll starts at once.
  useEffect(() => {
    const t = setTimeout(() => void loadPhysics().catch(() => {}), 2500);
    return () => clearTimeout(t);
  }, []);

  // Online, the camera stays on your side once your color is known.
  useEffect(() => {
    if (seat === 'white' || seat === 'black') setCamera((c) => ({ ...c, side: seat, nonce: c.nonce + 1 }));
  }, [seat]);

  useEffect(() => {
    /** Logs a batch of game events and reacts to them (the moment the board shows them). */
    const applyBatch = ({ events, before, after }: Batch) => {
      const typeOf = (id: string) => findPiece(before.board, id)?.type ?? findPiece(after.board, id)?.type;
      addLog(describeEvents(events, typeOf));
      const passed = events.some((ev) => ev.type === 'turnPassed');
      if (passed) playSfx('turn', { delay: 0.25 });
      if (events.some((ev) => ev.type === 'check')) playSfx('check', { delay: 0.45 });
      if (events.some((ev) => ev.type === 'specialProposed')) playSfx('ruling');
      const chaos = events.find((ev) => ev.type === 'chaos');
      if (chaos) {
        playSfx('chaos');
        setChaosBanner({ title: chaos.title, narration: chaos.narration });
      }
      if (events.some((ev) => ev.type === 'timedOut')) playSfx('timeout');
      const exposed = events.find((ev) => ev.type === 'ownKingExposed');
      if (exposed) setWarning(`${COLOR_NAME[exposed.color]} 킹이 공격받는 위치에 놓였습니다.`);
      else if (passed) setWarning(null);
      const proposed = events.find((ev) => ev.type === 'specialProposed');
      if (proposed && (seat === 'both' || proposed.color === seat)) setText('');
      setSelected(null);
      if (seat === 'both' && after.status.kind === 'playing' && after.turn !== before.turn) {
        // Hotseat: swing the camera to the player whose turn it is.
        setCamera((c) => ({ ...c, side: after.turn, nonce: c.nonce + 1 }));
      }
    };

    /** Rolls the die on the table: simulate, look at the tray, then reveal via `done`. */
    const startRoll = (roll: number, outcome: Outcome, done: () => void) => {
      setDice({ roll, outcome, done, landed: false });
      setDiceRoll({ run: null, skin: new Quaternion(), outcome, skipped: false });
      setCamera((c) => {
        if (c.mode !== 'dice') cameraBeforeDice.current = c;
        return { ...c, mode: 'dice', nonce: c.nonce + 1 };
      });
      simulateRoll()
        .then((run) => setDiceRoll((r) => (r ? { ...r, run, skin: skinRotationFor(roll, run.final) } : r)))
        // Without physics, just show the number.
        .catch(() => setDice((d) => (d ? { ...d, landed: true } : d)));
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
        if (resolved && !head.rolled) {
          head.rolled = true;
          setFrozen(head.before);
          startRoll(resolved.roll, resolved.outcome, () => {
            setDice(null);
            pump();
          });
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
      if (e.kind === 'chat') {
        if (!e.mine) playSfx('chat');
        if (tabRef.current !== 'chat') setUnread((n) => n + 1);
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

  const diceRef = useRef(dice);
  diceRef.current = dice;
  const skipRequested = useRef(false);

  /** Reveals the rolled result on the board and turns the camera back. */
  const finishRoll = () => {
    const d = diceRef.current;
    if (!d) return;
    diceRef.current = null;
    skipRequested.current = false;
    setDiceRoll(null);
    setCamera((c) => ({ ...(cameraBeforeDice.current ?? { mode: 'side', side: c.side }), nonce: c.nonce + 1 }));
    cameraBeforeDice.current = null;
    d.done();
  };

  const skipRoll = () => {
    if (!diceRoll?.run) return finishRoll(); // still computing: nothing to watch yet
    skipRequested.current = true;
    setDiceRoll((r) => (r ? { ...r, skipped: true } : r));
  };

  const onDiceLanded = () => {
    if (skipRequested.current) return finishRoll();
    setDice((d) => (d ? { ...d, landed: true } : d));
  };

  // Let the result sink in for a moment, then reveal it on the board.
  useEffect(() => {
    if (!dice?.landed) return;
    const crit = dice.outcome === 'critSuccess' || dice.outcome === 'critFailure';
    const t = setTimeout(finishRoll, crit ? 2000 : 1400);
    return () => clearTimeout(t);
  }, [dice?.landed]);

  const game = frozen ?? view.state;
  const targets = useMemo(() => (selected === null ? [] : legalTargets(game, selected).map((t) => t.to)), [game, selected]);

  const sideToMove = game.turn;
  const playing = game.status.kind === 'playing';
  const myTurn = seat === 'both' || seat === sideToMove;
  const inCheck = playing && isInCheck(game.board, sideToMove);
  const checkedKing = inCheck ? findKing(game.board, sideToMove) : null;
  const pending = game.pending;
  const connected = view.connection.kind === 'local' || view.connection.kind === 'hosting' || view.connection.kind === 'connected';
  const locked = !playing || view.gmBusy || !!pending || !myTurn || !connected || !!dice;
  // A turn has to be used for something: a normal move ends it by itself, so passing is only
  // for after a special action (or when no piece can move at all).
  const canEndTurn = game.usedApThisTurn || !hasAnyMove(game);
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

  const resetView = () => setCamera((c) => ({ mode: 'side', side: seat === 'white' || seat === 'black' ? seat : sideToMove, nonce: c.nonce + 1 }));
  const toggleTopView = () => setCamera((c) => ({ ...c, mode: c.mode === 'top' ? 'side' : 'top', nonce: c.nonce + 1 }));

  /** Back to the waiting room (this screen goes away). */
  const restart = () => session.restart();

  const canAfford = pending ? game.ap[pending.color] >= pending.ruling.cost : false;
  const canActOnPending = !!pending && (seat === 'both' || seat === pending.color) && connected;
  const nameOf = (color: Color) => view.members.find((m) => m.role === color)?.name;
  const absent = view.members.find((m) => (m.role === 'white' || m.role === 'black') && !m.online);
  const watchers = view.members.filter((m) => m.role === 'spectator').length;

  const placeholder = winner
    ? '게임 종료'
    : spectator
      ? '관전 중입니다'
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
        diceSide={seat === 'black' ? 1 : -1}
        diceRoll={diceRoll}
        onDiceLanded={onDiceLanded}
        ap={game.ap}
        captured={game.captured ?? []}
      />

      <div className="hud topbar">
      <header className="top">
        <div className={`turn turn-${sideToMove}`}>
          {winner ? `${COLOR_NAME[winner]} 승리!` : `${COLOR_NAME[sideToMove]}의 차례`}
          {online && !winner && nameOf(sideToMove) && <span className="turn-name">{nameOf(sideToMove)}</span>}
          <span className="turn-number">턴 {game.turnNumber}</span>
        </div>
        {view.timer && playing && !frozen && <TimerBadge timer={view.timer} mine={myTurn && !spectator} />}
        {(seat === 'white' || seat === 'black') && online && <div className={`badge me me-${seat}`}>나: {COLOR_NAME[seat]}</div>}
        {spectator && <div className="badge me">👁 관전 중</div>}
        {online && watchers > 0 && <div className="badge muted-badge">관전 {watchers}명</div>}
        {inCheck && <div className="badge check">체크!</div>}
        {view.gmBusy && <div className="badge busy">GM 판정 중…</div>}
        {warning && !winner && <div className="badge warn">⚠ {warning}</div>}
        {absent && playing && <div className="badge warn">{absent.name} 연결 끊김 · 재접속 대기 중</div>}
      </header>


      <div className="camera-buttons">
        <button onClick={resetView} title="내 쪽에서 비스듬히 보는 시점으로">
          시점 초기화
        </button>
        <button onClick={toggleTopView}>{camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'}</button>
        <button onClick={() => setShowPrecedents(true)} title="지금까지의 GM 판정 기록">
          📜 판례 ({game.precedents.length})
        </button>
        <button className="menu-button" onClick={() => setShowMenu(true)} aria-haspopup="menu" title="설정">
          ⚙ 설정
        </button>
      </div>
      </div>

      {(() => {
        const sq = hovered ?? selected;
        const piece = sq === null ? null : game.board[sq];
        return piece ? <PieceInfo piece={piece} square={sq!} /> : null;
      })()}

      <aside className={`hud panel ${collapsed ? 'collapsed' : ''}`}>
        <div className="panel-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
            게임
          </button>
          <button
            role="tab"
            aria-selected={tab === 'chat'}
            className={tab === 'chat' ? 'active' : ''}
            onClick={() => {
              setTab('chat');
              setUnread(0);
            }}
          >
            채팅{unread > 0 && <span className="unread">{unread}</span>}
          </button>
          <button
            className="collapse"
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? '기록 펼치기' : '기록 접기'}
            aria-label={collapsed ? '기록 펼치기' : '기록 접기'}
          >
            {collapsed ? '▴' : '▾'}
          </button>
        </div>
        {tab === 'log' ? (
          <>
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
              <button
                onClick={() => session.request({ type: 'endTurn' })}
                disabled={locked || !canEndTurn}
                title={canEndTurn ? '이번 턴을 마칩니다' : '수를 두거나 특수 행동을 시도해야 턴을 끝낼 수 있습니다'}
              >
                턴 종료
              </button>
            </div>
          </>
        ) : (
          <>
            <ol className="log chat" ref={chatRef}>
              {chat.length === 0 && (
                <li className="hint">
                  {online ? '방 안의 모두와 자유롭게 이야기하세요. 채팅은 게임 행동이 아니라서 GM에게 가지 않습니다.' : '핫시트에서는 지금 차례인 쪽 이름으로 메모가 남습니다.'}
                </li>
              )}
              {chat.map((m) => (
                <li key={m.id} className={`chat-line ${online ? (m.author === view.myKey ? 'mine' : '') : ''}`}>
                  <span className={`chat-who who-${m.role}`}>{m.name}</span>
                  <span className="chat-text">{m.text}</span>
                </li>
              ))}
            </ol>
            <form
              className="input-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!chatText.trim()) return;
                session.sendChat(chatText);
                setChatText('');
              }}
            >
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                placeholder={connected ? '채팅 메시지' : '연결을 기다리는 중'}
                disabled={!connected}
                maxLength={CHAT_MAX_LENGTH}
              />
              <button type="submit" disabled={!connected || !chatText.trim()}>
                보내기
              </button>
            </form>
          </>
        )}
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
                    AP {pending.ruling.cost}
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
              <p className="muted-line">{spectator ? `${COLOR_NAME[pending.color]}이(가) 시도할지 정하는 중입니다…` : '상대가 시도할지 정하는 중입니다…'}</p>
            )}
          </div>
        </div>
      )}

      {showMenu && (
        <SettingsMenu
          onClose={() => setShowMenu(false)}
          gm={{ isAuthority: view.isAuthority, name: view.gmName, busy: view.gmBusy, onOpen: () => setShowGmSettings(true) }}
          fullscreen={fullscreen}
          game={{ onLeave, online }}
          rules={rulesSummary(game.rules)}
        />
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

      <ConnectionOverlay connection={view.connection} onLeave={onLeave} />

      {chaosBanner && !dice && (
        <div className="chaos-banner" role="status" onClick={() => setChaosBanner(null)}>
          <div className="chaos-title">🌪 혼돈! {chaosBanner.title}</div>
          <div className="chaos-text">{chaosBanner.narration}</div>
        </div>
      )}

      {dice && (
        <div className="hud dice-hud">
          {dice.landed ? (
            <div className={`dice-result ${dice.outcome}`}>
              <span className="dice-number">{dice.roll}</span>
              <span className="dice-label">{OUTCOME_LABEL[dice.outcome]}</span>
            </div>
          ) : (
            <div className="dice-rolling">🎲 주사위를 굴리는 중…</div>
          )}
          <button onClick={dice.landed ? finishRoll : skipRoll}>{dice.landed ? '확인' : '건너뛰기'}</button>
        </div>
      )}

      {winner && connected && !dice && (
        <div className="overlay">
          <div className="victory">
            <h1>{COLOR_NAME[winner]} 승리</h1>
            <p>{COLOR_NAME[opponent(winner)]} 킹이 잡혔습니다.</p>
            {view.isAuthority ? (
              <button onClick={restart}>대기실로 (새 게임)</button>
            ) : (
              <p className="muted-line">방장이 대기실로 돌아가면 새 게임을 준비합니다.</p>
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

/** The turn clock: counts down locally between updates from the authority. */
function TimerBadge({ timer, mine }: { timer: TurnTimer; mine: boolean }) {
  const [, tick] = useState(0);
  const lastBeep = useRef<number | null>(null);
  useEffect(() => {
    if (!timer.running) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [timer]);
  const left = timeLeft(timer);
  const seconds = Math.ceil(left / 1000);
  const urgent = timer.running && seconds <= 10;
  // A soft tick for the last five seconds of your own turn.
  useEffect(() => {
    if (!mine || !timer.running || seconds > 5 || seconds <= 0 || lastBeep.current === seconds) return;
    lastBeep.current = seconds;
    playSfx('tick');
  }, [seconds, mine, timer.running]);
  return (
    <div className={`badge timer ${urgent ? 'urgent' : ''} ${timer.running ? '' : 'paused'}`} title={timer.running ? '이번 턴에 남은 시간' : 'GM이 판정하는 동안 시간이 멈춥니다'}>
      ⏱ {clockText(left)}
      {!timer.running && ' ⏸'}
    </div>
  );
}
