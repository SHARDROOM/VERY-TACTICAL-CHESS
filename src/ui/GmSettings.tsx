import { useState } from 'react';
import { CLAUDE_MODELS, type GmEffort } from '../gm/claudeGm';
import { OPENAI_MODEL_SUGGESTIONS } from '../gm/openaiGm';
import { GEMINI_MODEL_SUGGESTIONS } from '../gm/geminiGm';

type LlmProvider = 'claude' | 'openai' | 'gemini';

export type GmConfig =
  | { provider: 'fake' }
  | { provider: 'claude'; apiKey: string; model: string; effort: GmEffort }
  | { provider: 'openai' | 'gemini'; apiKey: string; model: string };

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

const PROVIDERS: { id: GmConfig['provider']; label: string }[] = [
  { id: 'claude', label: 'Claude (Anthropic)' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'gemini', label: 'Gemini (Google) · 무료 등급 키 가능' },
  { id: 'fake', label: '가짜 GM (개발용, 무료 · 칸 좌표가 있는 문장만 이해)' },
];

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  claude: CLAUDE_MODELS[0].id,
  openai: OPENAI_MODEL_SUGGESTIONS[0],
  gemini: GEMINI_MODEL_SUGGESTIONS[0],
};

const KEY_HINT: Record<LlmProvider, { label: string; placeholder: string; where: string }> = {
  claude: { label: 'Anthropic API 키', placeholder: 'sk-ant-…', where: 'Anthropic Console(console.anthropic.com)에서 발급할 수 있습니다.' },
  openai: { label: 'OpenAI API 키', placeholder: 'sk-…', where: 'OpenAI Platform(platform.openai.com)에서 발급할 수 있습니다.' },
  gemini: {
    label: 'Gemini API 키',
    placeholder: 'AIza…',
    where: 'Google AI Studio(aistudio.google.com)에서 무료 등급 키를 받을 수 있습니다. 무료 등급은 요청 횟수 제한이 있고, 데이터 활용 등 사용 조건은 Google 약관을 확인해 주세요.',
  },
};

export function GmSettings({ current, onSave, onClose }: Props) {
  const [provider, setProvider] = useState<GmConfig['provider']>(current.provider);
  // Keys and models are kept per provider while the dialog is open, so switching tabs loses nothing.
  const [keys, setKeys] = useState<Record<LlmProvider, string>>({
    claude: '',
    openai: '',
    gemini: '',
    ...(current.provider !== 'fake' && { [current.provider]: current.apiKey }),
  });
  const [models, setModels] = useState<Record<LlmProvider, string>>({
    ...DEFAULT_MODEL,
    ...(current.provider !== 'fake' && { [current.provider]: current.model }),
  });
  const [effort, setEffort] = useState<GmEffort>(current.provider === 'claude' ? current.effort : 'low');

  const llm = provider === 'fake' ? null : provider;
  const canSave = !llm || (keys[llm].trim().length > 0 && models[llm].trim().length > 0);

  const save = () => {
    if (!canSave) return;
    if (!llm) return onSave({ provider: 'fake' });
    const base = { apiKey: keys[llm].trim(), model: models[llm].trim() };
    onSave(llm === 'claude' ? { provider: llm, ...base, effort } : { provider: llm, ...base });
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
          {PROVIDERS.map((p) => (
            <label key={p.id} className="radio">
              <input type="radio" name="provider" checked={provider === p.id} onChange={() => setProvider(p.id)} />
              {p.label}
            </label>
          ))}
        </fieldset>

        {llm && (
          <>
            <label className="field">
              <span>{KEY_HINT[llm].label}</span>
              <input
                type="password"
                value={keys[llm]}
                onChange={(e) => setKeys((k) => ({ ...k, [llm]: e.target.value }))}
                placeholder={KEY_HINT[llm].placeholder}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>모델</span>
              {llm === 'claude' ? (
                <select value={models.claude} onChange={(e) => setModels((m) => ({ ...m, claude: e.target.value }))}>
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    list={`${llm}-models`}
                    value={models[llm]}
                    onChange={(e) => setModels((m) => ({ ...m, [llm]: e.target.value }))}
                    spellCheck={false}
                  />
                  <datalist id={`${llm}-models`}>
                    {(llm === 'openai' ? OPENAI_MODEL_SUGGESTIONS : GEMINI_MODEL_SUGGESTIONS).map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <small>목록에 없는 모델 이름도 직접 입력할 수 있습니다.</small>
                </>
              )}
            </label>
            {llm === 'claude' && (
              <label className="field">
                <span>판정 깊이</span>
                <select value={effort} onChange={(e) => setEffort(e.target.value as GmEffort)}>
                  {EFFORTS.map((x) => (
                    <option key={x.id} value={x.id}>{x.label}</option>
                  ))}
                </select>
              </label>
            )}
            <ul className="notes">
              <li>키는 이 브라우저 탭의 메모리에만 있고 어디에도 저장되지 않습니다. 상대 플레이어에게도 전송되지 않습니다. 새로고침하면 다시 입력해야 합니다.</li>
              <li>판정을 요청할 때마다 이 키로 API 요금이 청구됩니다.</li>
              <li>{KEY_HINT[llm].where}</li>
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
