import { useState } from 'react';
import { createPortal } from 'react-dom';
import { rememberBackups, rememberKeys, rememberedBackups, rememberedGm } from '../session/storage';
import { MAX_BACKUPS } from '../gm/failover';
import { gmLabel, sameModel } from './gmLabel';
import { CLAUDE_MODELS, type GmEffort } from '../gm/claudeGm';
import { OPENAI_MODEL_SUGGESTIONS } from '../gm/openaiGm';
import { GEMINI_MODEL_SUGGESTIONS } from '../gm/geminiGm';
import { COMPATIBLE_PRESETS, cleanBaseUrl, isLocalUrl, presetFor } from '../gm/compatible';
import { missingKey } from '../gm/createGm';
import { pingGm, type PingResult } from '../gm/ping';

type LlmProvider = 'claude' | 'openai' | 'gemini';

export type GmConfig =
  | { provider: 'fake' }
  | { provider: 'claude'; apiKey: string; model: string; effort: GmEffort }
  | { provider: 'openai' | 'gemini'; apiKey: string; model: string }
  /** Another service speaking OpenAI's Chat Completions (기타): its address, key and model (see compatible.ts). */
  | { provider: 'compatible'; apiKey: string; model: string; baseUrl: string };

interface Props {
  current: GmConfig;
  onSave: (config: GmConfig) => void;
  onClose: () => void;
  /**
   * Choosing an AI seat's own model (AI의 두뇌) instead of the GM: the seat's name, whether it
   * uses the GM's model now, and how to go back to that.
   */
  brain?: { seat: string; usesGm: boolean; onUseGm: () => void };
  /** Choosing backup GM number `backup` (예비 GM): a GM kind, without the fake one. */
  backup?: number;
  /** The backup GMs were changed (added, changed or taken out): they are saved at once (사용자 요청). */
  onBackups?: (backups: GmConfig[]) => void;
}

const EFFORTS: { id: GmEffort; label: string }[] = [
  { id: 'low', label: '빠르게 (기본)' },
  { id: 'medium', label: '보통' },
  { id: 'high', label: '신중하게 (느리고 비쌈)' },
];

const PROVIDERS: { id: GmConfig['provider']; name: string; note: string }[] = [
  { id: 'claude', name: 'Claude', note: 'Anthropic API 키가 필요합니다.' },
  { id: 'openai', name: 'OpenAI', note: 'OpenAI API 키가 필요합니다.' },
  { id: 'gemini', name: 'Gemini', note: 'Google API 키가 필요합니다. 무료 등급 키도 됩니다.' },
  { id: 'compatible', name: '기타', note: 'OpenRouter, DeepSeek, Groq, xAI, Mistral, 내 컴퓨터의 Ollama 등 OpenAI 호환 API.' },
  { id: 'fake', name: '가짜 GM', note: '키 없이 시험해 볼 때. 칸 좌표가 있는 문장만 알아듣고, 혼돈은 일으키지 않습니다.' },
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

/** An AI seat's model: the same as the GM, or one of the GM kinds (the fake one being the built-in AI). */
const BRAIN_PROVIDERS: { id: GmConfig['provider'] | 'same'; name: string; note: string }[] = [
  { id: 'same', name: 'GM과 같이', note: '방의 GM 모델이 이 AI의 특수 행동 문장도 짓습니다.' },
  ...PROVIDERS.filter((p) => p.id !== 'fake'),
  { id: 'fake', name: '내장 AI', note: '키 없이. 보호막, 저격, 기절, 검술 같은 정해진 행동만 고릅니다.' },
];

/** A config's key (none for the fake one). */
const keyOf = (c: GmConfig): string => (c.provider === 'fake' ? '' : c.apiKey);

export function GmSettings({ current, onSave, onClose, brain, backup, onBackups }: Props) {
  const [provider, setProvider] = useState<GmConfig['provider'] | 'same'>(brain?.usesGm ? 'same' : current.provider);
  // Keys and models are kept per provider while the dialog is open, so switching tabs loses nothing.
  // Every key typed in on this browser is filled in again.
  const remembered = rememberedGm().keys;
  const [keys, setKeys] = useState<Record<LlmProvider, string>>(() => ({
    claude: remembered.claude ?? '',
    openai: remembered.openai ?? '',
    gemini: remembered.gemini ?? '',
    ...(current.provider !== 'fake' && current.provider !== 'compatible' && current.apiKey && { [current.provider]: current.apiKey }),
  }));
  const [models, setModels] = useState<Record<LlmProvider, string>>({
    ...DEFAULT_MODEL,
    ...(current.provider !== 'fake' && current.provider !== 'compatible' && { [current.provider]: current.model }),
  });
  const [effort, setEffort] = useState<GmEffort>(current.provider === 'claude' ? current.effort : 'low');
  // Another service: its address and model, and a key per address (switching services keeps each one's).
  const [other, setOther] = useState(() =>
    current.provider === 'compatible' ? { baseUrl: current.baseUrl, model: current.model } : { baseUrl: COMPATIBLE_PRESETS[0].baseUrl, model: COMPATIBLE_PRESETS[0].models[0] ?? '' },
  );
  const [otherKeys, setOtherKeys] = useState<Record<string, string>>(() => ({
    ...remembered.compatible,
    ...(current.provider === 'compatible' && current.apiKey && { [current.baseUrl]: current.apiKey }),
  }));
  const otherUrl = cleanBaseUrl(other.baseUrl);
  const otherKey = (otherUrl && otherKeys[otherUrl]) || '';
  const preset = presetFor(other.baseUrl);
  const otherLocal = !!otherUrl && isLocalUrl(otherUrl);
  const pickPreset = (id: string) => {
    const p = COMPATIBLE_PRESETS.find((x) => x.id === id);
    if (!p) return setOther((o) => ({ ...o, baseUrl: '' }));
    // A model of the last service's means nothing here: the new one's first suggestion, or blank.
    setOther((o) => ({ baseUrl: p.baseUrl, model: preset && o.model && !preset.models.includes(o.model) ? o.model : (p.models[0] ?? '') }));
  };

  // The backup GMs (main settings only): kept with the GM when it is saved.
  const [backups, setBackups] = useState<GmConfig[]>(() => (brain || backup ? [] : rememberedBackups()));
  // An AI seat may take one of the saved backup GMs as it is, key and all (사용자 요청).
  const [savedBackups] = useState<GmConfig[]>(() => (brain ? rememberedBackups() : []));
  const [editing, setEditing] = useState<number | null>(null);
  // A backup GM is kept the moment it is set, changed or taken out (not only with the GM).
  const updateBackups = (next: GmConfig[]) => {
    setBackups(next);
    rememberBackups(next);
    onBackups?.(next);
  };
  const llm = provider === 'fake' || provider === 'same' || provider === 'compatible' ? null : provider;
  const otherMissing = provider === 'compatible' && !otherLocal && !otherKey.trim() ? '키' : null;
  const canSave =
    provider === 'compatible'
      ? !!otherUrl && other.model.trim().length > 0 && !otherMissing
      : !llm || (keys[llm].trim().length > 0 && models[llm].trim().length > 0);

  /** The GM as the form now stands (none for "GM과 같이" or an address not yet right). */
  const configNow = (): GmConfig | null => {
    if (provider === 'same') return null;
    if (provider === 'compatible') return otherUrl ? { provider: 'compatible', baseUrl: otherUrl, model: other.model.trim(), apiKey: otherKey.trim() } : null;
    if (!llm) return { provider: 'fake' };
    const base = { apiKey: keys[llm].trim(), model: models[llm].trim() };
    return llm === 'claude' ? { provider: llm, ...base, effort } : { provider: llm, ...base };
  };

  // 응답 확인: a short question to the model as filled in; the answer stays while the form does.
  const [ping, setPing] = useState<{ of: string; result: PingResult | null } | null>(null);
  const formNow = JSON.stringify(configNow());
  const pingShown = ping && ping.of === formNow ? ping.result : undefined;
  const checking = pingShown === null;
  const check = async () => {
    const config = configNow();
    if (!config || !canSave) return;
    const of = JSON.stringify(config);
    setPing({ of, result: null });
    const result = await pingGm(config);
    setPing((p) => (p?.of === of ? { of, result } : p));
  };

  const save = () => {
    if (!canSave) return;
    if (provider === 'same') return brain?.onUseGm();
    // A seat's or a backup's key is kept with it (its caller remembers it), not as the GM's.
    if (!brain && !backup) {
      rememberKeys({ ...keys, compatible: otherKeys });
      rememberBackups(backups);
    }
    const config = configNow();
    if (config) onSave(config);
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
        <h2>{brain ? `${brain.seat} AI의 두뇌` : backup ? `예비 GM ${backup}` : 'GM 설정'}</h2>
        <p className="settings-lead">
          {brain
            ? '이 AI가 특수 행동 문장을 지을 모델과 키를 고르세요. 일반 수는 엔진이 두고(난이도대로), 판정은 방의 GM이 합니다.'
            : backup
              ? '앞의 GM이 막히면(사용 한도, 요청 몰림, 너무 느림, 연결 안 됨, 키 오류) 이 GM에 대신 묻습니다.'
              : '특수 행동을 판정하고 혼돈을 일으킬 GM을 고르세요.'}
        </p>
        {brain && savedBackups.length > 0 && (
          <section className="brain-quick" aria-label="예비 GM에서 바로 고르기">
            <h3>예비 GM에서 바로 고르기</h3>
            <div className="brain-quick-list">
              {savedBackups.map((b, i) => {
                // The one this seat took: the same model with the same key (two backups may share a model).
                const now = !brain.usesGm && sameModel(b, current) && keyOf(b) === keyOf(current);
                // One without a key (its key not here yet, e.g. synced before the passphrase) would do nothing.
                const keyless = missingKey(b);
                return (
                  <button
                    key={i}
                    type="button"
                    className={now ? 'active' : ''}
                    aria-pressed={now}
                    disabled={keyless}
                    title={keyless ? '키가 없습니다. ⚙ GM 설정에서 이 예비 GM에 키를 넣으면 고를 수 있습니다.' : undefined}
                    onClick={() => onSave(b)}
                  >
                    <span className="brain-quick-num">예비 {i + 1}</span>
                    <span className="brain-quick-name">{gmLabel(b)}</span>
                  </button>
                );
              })}
            </div>
            <p className="muted-line">누르면 그 예비 GM의 모델과 키로 바로 정합니다. 키가 없는 예비 GM은 고를 수 없습니다. 다른 모델은 아래에서 고르세요.</p>
          </section>
        )}
        <fieldset className="provider-grid">
          <legend className="sr-only">{brain ? '모델 종류' : 'GM 종류'}</legend>
          {(brain ? BRAIN_PROVIDERS : backup ? PROVIDERS.filter((p) => p.id !== 'fake') : PROVIDERS).map((p) => (
            <label key={p.id} className={`provider-tile ${provider === p.id ? 'active' : ''}`}>
              <input type="radio" name="provider" checked={provider === p.id} onChange={() => setProvider(p.id)} />
              <span className="provider-name">{p.name}</span>
              <span className="provider-note">{p.note}</span>
            </label>
          ))}
        </fieldset>

        {provider === 'compatible' && (
          <>
            <label className="field">
              <span>서비스</span>
              <select value={preset?.id ?? 'custom'} onChange={(e) => pickPreset(e.target.value)}>
                {COMPATIBLE_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                <option value="custom">직접 입력</option>
              </select>
            </label>
            <label className="field">
              <span>API 주소</span>
              <input
                value={other.baseUrl}
                onChange={(e) => setOther((o) => ({ ...o, baseUrl: e.target.value }))}
                type="url"
                placeholder="https://…/v1"
                autoComplete="off"
                spellCheck={false}
              />
              {other.baseUrl.trim() && !otherUrl && <small className="field-error">https 주소여야 합니다(http는 내 컴퓨터 localhost만).</small>}
              {!other.baseUrl.trim() && <small>OpenAI 호환 API의 주소. 뒤에 /chat/completions가 붙습니다.</small>}
            </label>
            <label className="field">
              <span>API 키{otherLocal ? ' (없어도 됨)' : ''}</span>
              <input
                type="password"
                value={otherKey}
                onChange={(e) => otherUrl && setOtherKeys((k) => ({ ...k, [otherUrl]: e.target.value }))}
                disabled={!otherUrl}
                placeholder={otherLocal ? '내 컴퓨터의 서버는 비워 두세요' : '이 서비스의 API 키'}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>모델</span>
              <input list="compatible-models" value={other.model} onChange={(e) => setOther((o) => ({ ...o, model: e.target.value }))} placeholder="서비스 문서의 모델 이름" spellCheck={false} />
              <datalist id="compatible-models">
                {(preset?.models ?? []).map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </>
        )}


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
          </>
        )}

        {(llm || provider === 'compatible') && (
          <ul className="notes">
            {brain ? (
              <>
                <li>키는 이 자리의 AI 몫으로 이 브라우저에만 기억됩니다. 다른 사람에게는 전송되지 않습니다. 지우려면 "GM과 같이"로 바꾸세요.</li>
                <li>이 AI가 특수 행동을 지을 때마다 이 키로 API 요금이 청구됩니다. 판정은 GM의 키로 따로 청구됩니다.</li>
              </>
            ) : (
              <>
                <li>키는 이 브라우저에만 기억되어 새로고침해도 다시 넣지 않아도 됩니다. 상대 플레이어에게는 전송되지 않습니다. 지우려면 칸을 비우고 다른 GM(예: 가짜 GM)으로 저장하세요. 같이 쓰는 컴퓨터라면 다 쓴 뒤 지워 주세요.</li>
                <li>판정을 요청할 때마다 이 키로 API 요금이 청구됩니다.</li>
              </>
            )}
            {llm && <li>{KEY_HINT[llm].where}</li>}
            {provider === 'compatible' && (
              <>
                {preset && <li>{preset.where}</li>}
                <li>판정은 긴 JSON으로 받습니다. 작은 모델이나 JSON을 잘 못 쓰는 모델은 판정이 자주 실패할 수 있으니, 되도록 큰 모델을 고르세요.</li>
              </>
            )}
          </ul>
        )}

        {(llm || provider === 'compatible') && (
          <div className="ping-row">
            <button type="button" onClick={() => void check()} disabled={!canSave || checking} title="짧은 질문 하나를 보내 이 키와 모델로 실제로 답이 오는지 봅니다(요금은 아주 조금).">
              {checking ? '확인 중…' : '응답 확인'}
            </button>
            {pingShown && (
              <span className={`ping-result ${pingShown.ok ? 'ok' : 'bad'}`} role="status">
                {pingShown.ok ? `✓ 응답함 (${(pingShown.ms / 1000).toFixed(1)}초)` : `✗ ${pingShown.message}`}
              </span>
            )}
          </div>
        )}

        {!brain && !backup && (
          <section className="backup-gms" aria-label="예비 GM">
            <h3>예비 GM</h3>
            <p className="muted-line">GM이 막히면(사용 한도, 요청 몰림, 너무 느림, 연결 안 됨, 키 오류) 차례로 대신 묻습니다. 막힌 GM은 2분 쉬고(키 오류면 계속), 넘어갈 때 기록에 알립니다. 예비 GM은 넣거나 바꾸거나 빼는 즉시 저장됩니다.</p>
            {backups.length > 0 && (
              <ol>
                {backups.map((b, i) => (
                  <li key={i}>
                    <span className="backup-name">
                      {i + 1}. {gmLabel(b)}
                    </span>
                    <button type="button" onClick={() => setEditing(i)}>바꾸기</button>
                    <button type="button" onClick={() => updateBackups(backups.filter((_, k) => k !== i))}>빼기</button>
                  </li>
                ))}
              </ol>
            )}
            {backups.length < MAX_BACKUPS && (
              <button type="button" onClick={() => setEditing(backups.length)}>
                + 예비 GM 추가
              </button>
            )}
            <p className="muted-line">같은 회사의 무료 키 여러 개로 사용 한도를 늘리는 것은 그 회사 약관 위반일 수 있습니다. 다른 회사나 다른 모델을 예비로 두세요(요청이 몰린 것은 같은 모델이면 키를 바꿔도 그대로입니다).</p>
          </section>
        )}

        <div className="choice-row">
          <button type="submit" className="primary" disabled={!canSave}>
            {(llm && !keys[llm].trim()) || otherMissing ? 'API 키를 넣어 주세요' : brain ? '이 두뇌로 정하기' : backup ? '이 예비 GM으로 정하기' : '이 GM으로 정하기'}
          </button>
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </form>
      {editing !== null &&
        // On top of the whole screen (inside this dialog it would scroll along with it).
        createPortal(
        <GmSettings
          current={backups[editing] ?? { provider: 'compatible', baseUrl: COMPATIBLE_PRESETS[0].baseUrl, model: COMPATIBLE_PRESETS[0].models[0] ?? '', apiKey: '' }}
          backup={editing + 1}
          onClose={() => setEditing(null)}
          onSave={(config) => {
            const next = [...backups];
            next[editing] = config;
            updateBackups(next);
            setEditing(null);
          }}
        />,
        document.body,
      )}
    </div>
  );
}
