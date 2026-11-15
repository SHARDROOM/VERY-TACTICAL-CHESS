import { DOODLE_COLORS, MAX_NOTE_LENGTH, type Doodle, type DoodleOp } from '../session/doodle';
import type { DoodleTool, DoodleToolKind } from '../scene/DoodleLayer';
import { Icon, type IconName } from './Icon';

const WIDTHS = [
  { value: 0.06, label: '가는 펜' },
  { value: 0.14, label: '굵은 펜' },
];

const TOOLS: { kind: DoodleToolKind; icon: IconName; label: string; hint: string }[] = [
  { kind: 'pen', icon: 'pencil', label: '펜', hint: '끌어서 그리기' },
  { kind: 'note', icon: 'note', label: '메모', hint: '글을 쓰고 놓을 곳을 누르기' },
  { kind: 'erase', icon: 'eraser', label: '지우개', hint: '지울 낙서를 누르기' },
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
        <div className="segmented" role="radiogroup" aria-label="도구">
          {TOOLS.map((t) => (
            <button
              key={t.kind}
              role="radio"
              aria-checked={tool.kind === t.kind}
              className={tool.kind === t.kind ? 'active' : ''}
              onClick={() => set({ kind: t.kind })}
              title={t.hint}
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </div>
        <button
          className="icon-only"
          onClick={() => mine.length && onDoodle({ op: 'remove', id: mine[mine.length - 1].id })}
          disabled={!mine.length}
          title="내 마지막 낙서 지우기"
          aria-label="내 마지막 낙서 지우기"
        >
          <Icon name="undo" />
        </button>
        <button className="close primary" onClick={onClose} title="낙서를 끝내고 시점 조작으로 돌아가기">
          <Icon name="check" />
          완료
        </button>
      </div>
      <div className="doodle-row">
        <div className="swatches" role="radiogroup" aria-label="색">
          {DOODLE_COLORS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={tool.color === c}
              className={`swatch ${tool.color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => set({ color: c })}
              aria-label={`색 ${c}`}
            />
          ))}
        </div>
        {tool.kind === 'pen' && (
          <div className="widths" role="radiogroup" aria-label="굵기">
            {WIDTHS.map((w) => (
              <button
                key={w.value}
                role="radio"
                aria-checked={tool.width === w.value}
                className={`width ${tool.width === w.value ? 'active' : ''}`}
                onClick={() => set({ width: w.value })}
                title={w.label}
                aria-label={w.label}
              >
                <span className="width-sample" style={{ height: Math.round(w.value * 30), background: tool.color }} />
              </button>
            ))}
          </div>
        )}
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
