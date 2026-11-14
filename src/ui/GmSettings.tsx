import { useState } from 'react';
import { CLAUDE_MODELS, type GmEffort } from '../gm/claudeGm';

export type GmConfig =
  | { provider: 'fake' }
  | { provider: 'claude'; apiKey: string; model: string; effort: GmEffort };

interface Props {
  current: GmConfig;
  onSave: (config: GmConfig) => void;
  onClose: () => void;
}

const EFFORTS: { id: GmEffort; label: string }[] = [
  { id: 'low', label: '빠르게 (기본)' },
  { id: 'medium', label: '보통' },
  { id: 'high', label: '신중하게 (느리고 비쌈)' },
];

export function GmSettings({ current, onSave, onClose }: Props) {
  const [provider, setProvider] = useState<GmConfig['provider']>(current.provider);
  const [apiKey, setApiKey] = useState(current.provider === 'claude' ? current.apiKey : '');
  const [model, setModel] = useState<string>(current.provider === 'claude' ? current.model : CLAUDE_MODELS[0].id);
  const [effort, setEffort] = useState<GmEffort>(current.provider === 'claude' ? current.effort : 'low');

  const canSave = provider === 'fake' || apiKey.trim().length > 0;
  const save = () => {
    if (!canSave) return;
    onSave(provider === 'fake' ? { provider } : { provider, apiKey: apiKey.trim(), model, effort });
  };

  return (
    <div className="overlay">
      <form
        className="dialog settings"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <h2>GM 설정</h2>
        <fieldset>
          <label className="radio">
            <input type="radio" checked={provider === 'claude'} onChange={() => setProvider('claude')} />
            Claude (내 API 키 사용)
          </label>
          <label className="radio">
            <input type="radio" checked={provider === 'fake'} onChange={() => setProvider('fake')} />
            가짜 GM (개발용, 무료 · 칸 좌표가 있는 문장만 이해)
          </label>
        </fieldset>

        {provider === 'claude' && (
          <>
            <label className="field">
              <span>Anthropic API 키</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>모델</span>
              <select value={model} onChange={(e) => setModel(e.target.value)}>
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>판정 깊이</span>
              <select value={effort} onChange={(e) => setEffort(e.target.value as GmEffort)}>
                {EFFORTS.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
            </label>
            <ul className="notes">
              <li>키는 이 브라우저 탭의 메모리에만 있고 어디에도 저장되지 않습니다. 새로고침하면 다시 입력해야 합니다.</li>
              <li>판정을 요청할 때마다 이 키로 Claude API 요금이 청구됩니다.</li>
              <li>키는 Anthropic Console(console.anthropic.com)에서 발급할 수 있습니다.</li>
            </ul>
          </>
        )}

        <div className="choice-row">
          <button type="submit" className="primary" disabled={!canSave}>저장</button>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </form>
    </div>
  );
}
