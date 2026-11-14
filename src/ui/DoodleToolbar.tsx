import { DOODLE_COLORS, MAX_NOTE_LENGTH, type Doodle, type DoodleOp } from '../session/doodle';
import type { DoodleTool } from '../scene/DoodleLayer';

const WIDTHS = [
  { value: 0.06, label: '가늘게' },
  { value: 0.14, label: '굵게' },
];

interface Props {
  tool: DoodleTool;
  onTool: (tool: DoodleTool) => void;
  onClose: () => void;
  doodles: Doodle[];
  myKey: string;
  moderator: boolean;
  onDoodle: (op: DoodleOp) => void;
}

/** Pen, note and eraser, colours and widths, undo and clearing. */
export function DoodleToolbar({ tool, onTool, onClose, doodles, myKey, moderator, onDoodle }: Props) {
  const set = (change: Partial<DoodleTool>) => onTool({ ...tool, ...change });
  const mine = doodles.filter((d) => d.author === myKey);
  return (
    <div className="hud doodle-bar" role="toolbar" aria-label="낙서 도구">
      <div className="doodle-row">
        <button className={tool.kind === 'pen' ? 'active' : ''} onClick={() => set({ kind: 'pen' })} title="펜: 끌어서 그리기">
          ✏️ 펜
        </button>
        <button className={tool.kind === 'note' ? 'active' : ''} onClick={() => set({ kind: 'note' })} title="메모: 글을 쓰고 놓을 곳을 누르기">
          🔤 메모
        </button>
        <button className={tool.kind === 'erase' ? 'active' : ''} onClick={() => set({ kind: 'erase' })} title={moderator ? '지우개: 누른 낙서를 지움' : '지우개: 내 낙서를 눌러 지움'}>
          🧽 지우개
        </button>
        <button onClick={() => mine.length && onDoodle({ op: 'remove', id: mine[mine.length - 1].id })} disabled={!mine.length} title="내 마지막 낙서 지우기">
          ↶
        </button>
        <button className="close" onClick={onClose} title="낙서 끝내기 (시점 조작으로 돌아가기)">
          완료
        </button>
      </div>
      <div className="doodle-row">
        {DOODLE_COLORS.map((c) => (
          <button
            key={c}
            className={`swatch ${tool.color === c ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => set({ color: c })}
            aria-label={`색 ${c}`}
          />
        ))}
        {tool.kind === 'pen' &&
          WIDTHS.map((w) => (
            <button key={w.value} className={tool.width === w.value ? 'active' : ''} onClick={() => set({ width: w.value })}>
              {w.label}
            </button>
          ))}
      </div>
      {tool.kind === 'note' && (
        <input
          className="doodle-note"
          value={tool.noteText}
          maxLength={MAX_NOTE_LENGTH}
          placeholder="메모를 쓰고 테이블이나 보드를 누르세요"
          onChange={(e) => set({ noteText: e.target.value })}
        />
      )}
      <div className="doodle-row small">
        <button className="link" onClick={() => onDoodle({ op: 'clear', all: false })} disabled={!mine.length}>
          내 낙서 모두 지우기
        </button>
        {moderator && (
          <button className="link" onClick={() => onDoodle({ op: 'clear', all: true })} disabled={!doodles.length}>
            전부 지우기
          </button>
        )}
      </div>
    </div>
  );
}
