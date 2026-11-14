import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  applyCommand,
  createInitialState,
  findKing,
  isInCheck,
  legalTargets,
  opponent,
  rankOf,
  parseMoveText,
  type Command,
  type GameState,
  type PromotionType,
  type Square,
} from './engine';
import { BoardScene, type CameraRequest } from './scene/BoardScene';
import { COLOR_NAME, PIECE_NAME, REJECT_MESSAGE, describeEvents } from './ui/messages';
import './App.css';

interface LogLine {
  id: number;
  text: string;
  tone: 'normal' | 'warn' | 'error';
}

let nextLogId = 1;

export default function App() {
  const [game, setGame] = useState<GameState>(createInitialState);
  const [selected, setSelected] = useState<Square | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [text, setText] = useState('');
  const [camera, setCamera] = useState<CameraRequest>({ mode: 'side', side: 'white', nonce: 0 });
  const [warning, setWarning] = useState<string | null>(null);
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log]);
  const [promotionChoice, setPromotionChoice] = useState<{ from: Square; to: Square } | null>(null);

  const targets = useMemo(
    () => (selected === null ? [] : legalTargets(game, selected).map((t) => t.to)),
    [game, selected],
  );

  const sideToMove = game.turn;
  const inCheck = game.status.kind === 'playing' && isInCheck(game.board, sideToMove);
  const checkedKing = inCheck ? findKing(game.board, sideToMove) : null;

  const addLog = (lines: string[], tone: LogLine['tone'] = 'normal') =>
    setLog((l) => [...l, ...lines.map((t) => ({ id: nextLogId++, text: t, tone: t.startsWith('⚠') ? 'warn' : tone }))]);

  const run = (cmd: Command): boolean => {
    const result = applyCommand(game, cmd);
    if (!result.ok) {
      addLog([REJECT_MESSAGE[result.reason]], 'error');
      return false;
    }
    const typeOf = (id: string) => game.board.find((p) => p?.id === id)?.type;
    addLog(describeEvents(result.events, typeOf));
    const exposed = result.events.find((e) => e.type === 'ownKingExposed');
    setWarning(exposed ? '방금 둔 수로 내 킹이 공격받는 위치에 놓였습니다.' : null);
    setGame(result.state);
    setSelected(null);
    if (result.state.status.kind === 'playing' && result.state.turn !== game.turn) {
      // Hotseat: swing the camera to the player whose turn it is.
      setCamera((c) => ({ ...c, side: result.state.turn, nonce: c.nonce + 1 }));
    }
    return true;
  };

  const onSquareClick = (sq: Square) => {
    if (game.status.kind !== 'playing') return;
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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = text.trim();
    if (!input) return;
    const parsed = parseMoveText(input);
    if (!parsed) {
      addLog([`"${input}"을(를) 이해하지 못했습니다. 예: e2e4`], 'error');
      return;
    }
    if (run({ type: 'move', ...parsed })) setText('');
  };

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
    setCamera((c) => ({ mode: 'side', side: 'white', nonce: c.nonce + 1 }));
  };

  const winner = game.status.kind === 'won' ? game.status.winner : null;

  return (
    <div className="app">
      <BoardScene
        board={game.board}
        selected={selected}
        targets={targets}
        checkedKing={checkedKing}
        camera={camera}
        onSquareClick={onSquareClick}
      />

      <header className="hud top">
        <div className={`turn turn-${sideToMove}`}>
          {winner ? `${COLOR_NAME[winner]} 승리!` : `${COLOR_NAME[sideToMove]}의 차례`}
          <span className="turn-number">턴 {game.turnNumber}</span>
        </div>
        {inCheck && <div className="badge check">체크!</div>}
        {warning && !winner && <div className="badge warn">⚠ {warning}</div>}
      </header>

      <div className="hud camera-buttons">
        <button onClick={() => setCamera((c) => ({ mode: 'side', side: game.turn, nonce: c.nonce + 1 }))}>시점 초기화</button>
        <button onClick={() => setCamera((c) => ({ ...c, mode: c.mode === 'top' ? 'side' : 'top', nonce: c.nonce + 1 }))}>
          {camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'}
        </button>
      </div>

      <aside className="hud panel">
        <ol className="log" ref={logRef}>
          {log.length === 0 && <li className="hint">기물을 클릭하거나 아래에 수를 입력하세요. 예: e2e4</li>}
          {log.map((l) => (
            <li key={l.id} className={l.tone}>{l.text}</li>
          ))}
        </ol>
        <form onSubmit={onSubmit} className="input-row">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={winner ? '게임 종료' : `${COLOR_NAME[sideToMove]}: 수 입력 (예: e2e4, e7e8q)`}
            disabled={!!winner}
            maxLength={200}
          />
          <button type="submit" disabled={!!winner}>두기</button>
        </form>
      </aside>

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
