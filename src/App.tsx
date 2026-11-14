import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  applyCommand,
  createInitialState,
  findKing,
  isInCheck,
  legalTargets,
  opponent,
  rankOf,
  type Color,
  type Command,
  type GameState,
  type Outcome,
  type Piece,
  type PromotionType,
  type Square,
} from './engine';
import { BoardScene, type CameraRequest } from './scene/BoardScene';
import { COLOR_NAME, OUTCOME_LABEL, PIECE_NAME, REJECT_MESSAGE, describeEvents, type LogEntry, type LogTone } from './ui/messages';
import { PrecedentList } from './ui/PrecedentList';
import { FakeGameMaster } from './gm/fakeGm';
import { ClaudeGameMaster } from './gm/claudeGm';
import { OpenAiGameMaster } from './gm/openaiGm';
import { GeminiGameMaster } from './gm/geminiGm';
import { GmError } from './gm/errors';
import { GmSettings, type GmConfig } from './ui/GmSettings';
import { PieceInfo } from './ui/PieceInfo';
import { parseGmRuling } from './gm/parse';
import type { GameMaster } from './gm/types';
import { rollD20, successChance } from './dice';
import { parseMoveText } from './engine';
import './App.css';

interface LogLine extends LogEntry {
  id: number;
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

function createGm(config: GmConfig): GameMaster {
  switch (config.provider) {
    case 'claude':
      return new ClaudeGameMaster({ apiKey: config.apiKey, model: config.model, effort: config.effort });
    case 'openai':
      return new OpenAiGameMaster({ apiKey: config.apiKey, model: config.model });
    case 'gemini':
      return new GeminiGameMaster({ apiKey: config.apiKey, model: config.model });
    case 'fake':
      return new FakeGameMaster();
  }
}

const PROVIDER_LABEL: Record<GmConfig['provider'], string> = {
  claude: 'Claude GM',
  openai: 'OpenAI GM',
  gemini: 'Gemini GM',
  fake: '가짜 GM',
};

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

export default function App() {
  const [game, setGame] = useState<GameState>(() => createInitialState());
  const [selected, setSelected] = useState<Square | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [text, setText] = useState('');
  const [camera, setCamera] = useState<CameraRequest>({ mode: 'side', side: 'white', nonce: 0 });
  const [warning, setWarning] = useState<string | null>(null);
  const [gmBusy, setGmBusy] = useState(false);
  const [lastRoll, setLastRoll] = useState<{ roll: number; outcome: Outcome } | null>(null);
  const [showPrecedents, setShowPrecedents] = useState(false);
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);
  const [promotionChoice, setPromotionChoice] = useState<{ from: Square; to: Square } | null>(null);
  // The API key lives only here, in memory: never persisted.
  const [gmConfig, setGmConfig] = useState<GmConfig>({ provider: 'fake' });
  const [showGmSettings, setShowGmSettings] = useState(false);
  const [hovered, setHovered] = useState<Square | null>(null);
  const gm = useMemo(() => createGm(gmConfig), [gmConfig]);

  const targets = useMemo(
    () => (selected === null ? [] : legalTargets(game, selected).map((t) => t.to)),
    [game, selected],
  );

  const sideToMove = game.turn;
  const playing = game.status.kind === 'playing';
  const inCheck = playing && isInCheck(game.board, sideToMove);
  const checkedKing = inCheck ? findKing(game.board, sideToMove) : null;
  const pending = game.pending;
  const locked = !playing || gmBusy || !!pending;

  const addLog = (entries: LogEntry[]) => setLog((l) => [...l, ...entries.map((e) => ({ ...e, id: nextLogId++ }))]);
  const say = (text: string, tone: LogTone = 'normal') => addLog([{ text, tone }]);

  /** Runs a command against the current state. Returns the new state, or null if rejected. */
  const run = (cmd: Command, from: GameState = game): GameState | null => {
    const result = applyCommand(from, cmd);
    if (!result.ok) {
      say(REJECT_MESSAGE[result.reason] + (result.detail ? ` (${result.detail})` : ''), 'error');
      return null;
    }
    const typeOf = (id: string) => findPiece(from.board, id)?.type ?? findPiece(result.state.board, id)?.type;
    addLog(describeEvents(result.events, typeOf));
    const exposed = result.events.find((e) => e.type === 'ownKingExposed');
    if (exposed) setWarning('방금 행동으로 내 킹이 공격받는 위치에 놓였습니다.');
    else if (result.events.some((e) => e.type === 'turnPassed')) setWarning(null);
    const resolved = result.events.find((e) => e.type === 'specialResolved');
    if (resolved) setLastRoll({ roll: resolved.roll, outcome: resolved.outcome });
    else if (result.events.some((e) => e.type === 'turnPassed')) setLastRoll(null);
    setGame(result.state);
    setSelected(null);
    if (result.state.status.kind === 'playing' && result.state.turn !== from.turn) {
      // Hotseat: swing the camera to the player whose turn it is.
      setCamera((c) => ({ ...c, side: result.state.turn, nonce: c.nonce + 1 }));
    }
    return result.state;
  };

  const onSquareClick = (sq: Square) => {
    if (locked) return;
    const piece = game.board[sq];
    if (selected !== null && targets.includes(sq)) {
      const mover = game.board[selected];
      const lastRank = mover?.color === 'white' ? 7 : 0;
      if (mover?.type === 'pawn' && rankOf(sq) === lastRank) setPromotionChoice({ from: selected, to: sq });
      else run({ type: 'move', from: selected, to: sq });
      return;
    }
    if (piece && piece.color === game.turn) setSelected(sq === selected ? null : sq);
    else setSelected(null);
  };

  const declareSpecial = async (action: string) => {
    const snapshot = game;
    setGmBusy(true);
    try {
      const raw = await gm.rule({ action, state: snapshot });
      const parsed = parseGmRuling(raw);
      if (!parsed.ok) {
        say(`GM 응답 형식이 올바르지 않습니다 (${parsed.error}). AP는 쓰지 않았습니다. 다시 시도해 주세요.`, 'error');
        return;
      }
      if (run({ type: 'proposeSpecial', action, ruling: parsed.ruling }, snapshot)) setText('');
    } catch (err) {
      const reason = err instanceof GmError ? err.message : `GM 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
      say(`${reason} (AP는 쓰지 않았습니다. 입력한 문장은 그대로 남아 있으니 다시 보낼 수 있습니다.)`, 'error');
    } finally {
      setGmBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = text.trim();
    if (!input || locked) return;
    const parsed = parseMoveText(input);
    if (parsed) {
      const mover = game.board[parsed.from];
      const lastRank = mover?.color === 'white' ? 7 : 0;
      if (!parsed.promotion && mover?.type === 'pawn' && rankOf(parsed.to) === lastRank && legalTargets(game, parsed.from).some((t) => t.to === parsed.to)) {
        setPromotionChoice({ from: parsed.from, to: parsed.to });
        setText('');
        return;
      }
      if (run({ type: 'move', ...parsed })) setText('');
      return;
    }
    if (input.length > game.rules.actionMaxLength) {
      say(REJECT_MESSAGE.actionTooLong, 'error');
      return;
    }
    void declareSpecial(input);
  };

  const attempt = () => run({ type: 'attemptSpecial', roll: rollD20() });
  const cancel = () => run({ type: 'cancelSpecial' });
  const endTurn = () => run({ type: 'endTurn' });

  const promote = (type: PromotionType) => {
    if (!promotionChoice) return;
    run({ type: 'move', ...promotionChoice, promotion: type });
    setPromotionChoice(null);
  };

  const restart = () => {
    setGame(createInitialState());
    setSelected(null);
    setLog([]);
    setWarning(null);
    setLastRoll(null);
    setCamera((c) => ({ mode: 'side', side: 'white', nonce: c.nonce + 1 }));
  };

  const winner = game.status.kind === 'won' ? game.status.winner : null;
  const canAfford = pending ? game.ap[pending.color] >= pending.ruling.cost : false;

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

      <header className="hud top">
        <div className={`turn turn-${sideToMove}`}>
          {winner ? `${COLOR_NAME[winner]} 승리!` : `${COLOR_NAME[sideToMove]}의 차례`}
          <span className="turn-number">턴 {game.turnNumber}</span>
        </div>
        <ApMeter color="white" ap={game.ap.white} max={game.rules.apMax} active={sideToMove === 'white'} />
        <ApMeter color="black" ap={game.ap.black} max={game.rules.apMax} active={sideToMove === 'black'} />
        {inCheck && <div className="badge check">체크!</div>}
        {gmBusy && <div className="badge busy">GM 판정 중…</div>}
        {lastRoll && (
          <div className={`badge roll ${lastRoll.outcome}`}>
            🎲 {lastRoll.roll} — {OUTCOME_LABEL[lastRoll.outcome]}
          </div>
        )}
        {warning && !winner && <div className="badge warn">⚠ {warning}</div>}
      </header>

      {(() => {
        const sq = hovered ?? selected;
        const piece = sq === null ? null : game.board[sq];
        return piece ? <PieceInfo piece={piece} square={sq!} /> : null;
      })()}

      <div className="hud camera-buttons">
        <button onClick={() => setShowPrecedents(true)} title="이번 게임의 판례">
          📜 판례 {game.precedents.length}
        </button>
        <button onClick={() => setShowGmSettings(true)} disabled={gmBusy} title="GM 설정">
          ⚙ {PROVIDER_LABEL[gmConfig.provider]}
        </button>
        <button onClick={() => setCamera((c) => ({ mode: 'side', side: game.turn, nonce: c.nonce + 1 }))}>시점 초기화</button>
        <button onClick={() => setCamera((c) => ({ ...c, mode: c.mode === 'top' ? 'side' : 'top', nonce: c.nonce + 1 }))}>
          {camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'}
        </button>
      </div>

      <aside className="hud panel">
        <ol className="log" ref={logRef}>
          {log.length === 0 && (
            <li className="hint">
              기물을 클릭하거나 수를 입력하세요 (예: e2e4). 규칙 밖의 행동은 그대로 문장으로 쓰면 GM이 판정합니다.
              <br />
              지금 GM: {gm.name}. 예: "b1 나이트를 투석기로 e5까지 날린다", "d7 폰을 저격한다". 진짜 GM은 ⚙ 버튼에서 Claude, OpenAI, Gemini 중 하나의 API 키를 넣으면 켜집니다.
            </li>
          )}
          {log.map((l) => (
            <li key={l.id} className={l.tone}>{l.text}</li>
          ))}
        </ol>
        <form onSubmit={onSubmit} className="input-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={winner ? '게임 종료' : `${COLOR_NAME[sideToMove]}: 수 또는 특수 행동`}
            disabled={locked}
            maxLength={game.rules.actionMaxLength}
          />
          <button type="submit" disabled={locked || !text.trim()}>입력</button>
        </form>
        <div className="panel-footer">
          <span className="counter">{text.length}/{game.rules.actionMaxLength}</span>
          <button onClick={endTurn} disabled={locked}>턴 종료</button>
        </div>
      </aside>

      {pending && (
        <div className="overlay">
          <div className="dialog ruling">
            <div className="ruling-who">{COLOR_NAME[pending.color]}의 특수 행동</div>
            <blockquote>"{pending.action}"</blockquote>
            <h2>GM 판정</h2>
            <p>{pending.ruling.interpretation}</p>
            {pending.ruling.feasible ? (
              <dl className="ruling-stats">
                <div><dt>난이도</dt><dd>DC {pending.ruling.dc}</dd></div>
                <div><dt>비용</dt><dd>AP {pending.ruling.cost} <small>(보유 {game.ap[pending.color]})</small></dd></div>
                <div><dt>성공 확률</dt><dd>{Math.round(successChance(pending.ruling.dc) * 100)}%</dd></div>
              </dl>
            ) : (
              <p className="infeasible">GM이 불가능한 행동으로 판정했습니다.</p>
            )}
            {pending.ruling.feasible && (
              <ul className="crit-notes">
                <li>🎲 20: 대성공{pending.ruling.critSuccessEffects?.length ? ' — 더 좋은 결과' : ' — 성공과 같은 결과'} (DC와 상관없이 성공)</li>
                <li>🎲 1: 대실패{pending.ruling.critFailureEffects?.length ? ' — ⚠ 역효과가 있습니다' : ''} (DC와 상관없이 실패)</li>
              </ul>
            )}
            {pending.ruling.feasible && !canAfford && <p className="infeasible">AP가 부족해서 시도할 수 없습니다.</p>}
            <div className="choice-row">
              <button className="primary" onClick={attempt} disabled={!pending.ruling.feasible || !canAfford}>
                🎲 시도
              </button>
              <button onClick={cancel}>취소 (AP 사용 안 함)</button>
            </div>
          </div>
        </div>
      )}

      {showPrecedents && <PrecedentList precedents={game.precedents} onClose={() => setShowPrecedents(false)} />}

      {showGmSettings && (
        <GmSettings
          current={gmConfig}
          onClose={() => setShowGmSettings(false)}
          onSave={(config) => {
            setGmConfig(config);
            setShowGmSettings(false);
            say(`GM이 바뀌었습니다: ${createGm(config).name}`);
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
                <button key={t} onClick={() => promote(t)}>{PIECE_NAME[t]}</button>
              ))}
            </div>
            <button className="link" onClick={() => setPromotionChoice(null)}>취소</button>
          </div>
        </div>
      )}

      {winner && (
        <div className="overlay">
          <div className="victory">
            <h1>{COLOR_NAME[winner]} 승리</h1>
            <p>{COLOR_NAME[opponent(winner)]} 킹이 잡혔습니다.</p>
            <button onClick={restart}>새 게임</button>
          </div>
        </div>
      )}
    </div>
  );
}
