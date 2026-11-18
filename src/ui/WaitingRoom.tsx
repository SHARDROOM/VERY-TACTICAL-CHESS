import { useEffect, useMemo, useRef, useState } from 'react';
import { AI_LEVELS, AI_LEVEL_NAME, AI_SPECIALS, AI_SPECIALS_NAME, playersOf, type AiLevel, type AiSpecials, type Color, type RuleConfig } from '../engine';
import {
  AP_PER_TURN,
  CHAOS_CHANCES,
  CHAT_MAX_LENGTH,
  NAME_MAX_LENGTH,
  REROLL_COSTS,
  TIMEOUT_PENALTIES,
  TURN_SECONDS,
  type Session,
  type SessionView,
} from '../session/types';
import { saveName } from '../session/storage';
import { LobbyBackdrop } from './LobbyBackdrop';
import { ConnectionOverlay } from './ConnectionOverlay';
import { SettingsMenu, useFullscreen } from './SettingsMenu';
import { chaosLabel, rerollLabel, rulesSummary, secondsLabel } from './rules';
import { playSfx } from '../audio/sfx';
import { Icon } from './Icon';

const SEAT_LABEL: Record<Color, string> = { white: '백', black: '흑', red: '적', gray: '회색' };

interface Props {
  session: Session;
  view: SessionView;
  onLeave: () => void;
  onGmSettings: () => void;
}

/** Before a game: who is here, the room's rules, chat, and the host's start button. */
export function WaitingRoom({ session, view, onLeave, onGmSettings }: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const fullscreen = useFullscreen();
  const [copied, setCopied] = useState(false);
  const [chatText, setChatText] = useState('');
  const chatRef = useRef<HTMLOListElement>(null);
  const rules = view.state.rules;
  const host = view.isAuthority;
  const online = view.connection.kind !== 'local';
  const me = view.members.find((m) => m.key === view.myKey);
  const [name, setName] = useState(me?.name ?? '');
  // The board's seats (white, black, and red on the 3-player board) and who sits in each.
  const seats = playersOf(rules.map);
  const holder = (c: Color) => view.members.find((m) => m.role === c);
  const aiOf = (c: Color) => rules.ai?.[c as 'white'];
  const emptySeats = seats.filter((c) => !aiOf(c) && !holder(c)?.online);
  // AI special actions cost GM API calls (an API GM only: the fake GM is free).
  const aiSpends = host && view.chaosReady && seats.some((c) => (aiOf(c)?.specials ?? 'off') !== 'off');
  const bench = view.members.filter((m) => m.role === 'spectator');
  const canStart = !online || emptySeats.length === 0;
  const connected = view.connection.kind === 'local' || view.connection.kind === 'hosting' || view.connection.kind === 'connected';
  const inset = useMemo(() => ({ left: 0, top: 0, bottom: 0 }), []);

  useEffect(() => {
    if (me && document.activeElement?.id !== 'my-name') setName(me.name);
  }, [me?.name]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [view.chat.length]);

  // A little chime when someone new arrives.
  const count = useRef(view.members.length);
  useEffect(() => {
    if (view.members.length > count.current) playSfx('chat');
    count.current = view.members.length;
  }, [view.members.length]);

  const set = (change: Partial<RuleConfig>) => session.setRules(change);
  const commitName = () => {
    const clean = name.trim();
    if (!clean || clean === me?.name) return;
    session.setName(clean);
    saveName(clean);
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

  const conn = view.connection;
  return (
    <div className="waiting">
      <LobbyBackdrop key={rules.map} inset={inset} map={rules.map} />
      <div className="lobby-shade" />
      <div className="waiting-scroll">
        <div className="waiting-card">
          <header className="waiting-head">
            <h1>대기실</h1>
            <div className="waiting-head-actions">
              <button className="menu-button icon-only" onClick={() => setShowMenu(true)} aria-haspopup="menu" title="설정" aria-label="설정">
                <Icon name="gear" />
              </button>
              <button onClick={onLeave}>{online ? '나가기' : '로비로'}</button>
            </div>
          </header>

          {conn.kind === 'hosting' && (
            <section className="invite-box">
              <div className="muted-line">친구에게 방 코드나 링크를 보내 주세요. 들어온 사람은 대기석에서 원하는 자리를 골라 앉습니다.</div>
              <div className="room-code">{conn.code}</div>
              <div className="link-row">
                <input readOnly value={conn.link} onFocus={(e) => e.target.select()} />
                <button onClick={() => copyLink(conn.link)}>{copied ? '복사됨' : '링크 복사'}</button>
              </div>
            </section>
          )}

          <div className="waiting-cols">
            <section className="waiting-section">
              <h2>참가자 {online && <span className="muted">({view.members.length}/10)</span>}</h2>
              <ul className="seats" aria-label="자리">
                {seats.map((c) => {
                  const ai = aiOf(c);
                  const m = online ? holder(c) : undefined;
                  const mine = !!m && m.key === view.myKey;
                  const taken = !!ai || !!m || !online;
                  return (
                    <li key={c} className={`seat seat-${c} ${taken ? 'taken' : 'open'} ${m && !m.online ? 'offline' : ''} ${mine ? 'mine' : ''} ${ai ? 'ai' : ''}`}>
                      <span className="seat-stone" aria-hidden />
                      <span className="seat-label">{SEAT_LABEL[c]}</span>
                      <span className="member-name">
                        {ai ? (
                          host ? (
                            <span className="ai-pick">
                              <span aria-hidden>🤖</span>
                              <select aria-label={`${SEAT_LABEL[c]} AI 난이도`} value={ai.level} onChange={(e) => session.setAi(c, { ...ai, level: e.target.value as AiLevel })}>
                                {AI_LEVELS.map((l) => (
                                  <option key={l} value={l}>
                                    {AI_LEVEL_NAME[l]}
                                  </option>
                                ))}
                              </select>
                              <select aria-label={`${SEAT_LABEL[c]} AI 특수 행동`} value={ai.specials} onChange={(e) => session.setAi(c, { ...ai, specials: e.target.value as AiSpecials })}>
                                {AI_SPECIALS.map((x) => (
                                  <option key={x} value={x}>
                                    특수 행동 {AI_SPECIALS_NAME[x]}
                                  </option>
                                ))}
                              </select>
                            </span>
                          ) : (
                            <>
                              🤖 AI · {AI_LEVEL_NAME[ai.level]}
                              <span className="member-tag">특수 행동 {AI_SPECIALS_NAME[ai.specials]}</span>
                            </>
                          )
                        ) : !online ? (
                          <>이 기기</>
                        ) : m ? (
                          <>
                            {m.name}
                            {mine && <span className="member-tag">나</span>}
                            {m.host && <span className="member-tag">방장</span>}
                            {!m.online && <span className="member-tag off">연결 끊김</span>}
                          </>
                        ) : (
                          <span className="seat-empty">빈 자리</span>
                        )}
                      </span>
                      <span className="member-actions">
                        {ai ? (
                          host && <button onClick={() => session.setAi(c, null)}>{online ? '비우기' : '사람으로'}</button>
                        ) : mine ? (
                          <button onClick={() => session.takeSeat('spectator')}>일어나기</button>
                        ) : (
                          <>
                            {online && !m && me && (
                              <button className="primary" onClick={() => session.takeSeat(c)}>
                                앉기
                              </button>
                            )}
                            {host && !m && (
                              <button onClick={() => session.setAi(c, { level: 'normal', specials: 'some' })} title="이 자리를 AI가 둡니다">
                                AI 앉히기
                              </button>
                            )}
                            {m && host && !m.host && (
                              <button onClick={() => session.assignRole(m.key, 'spectator')} title={`${m.name}님을 대기석으로 보냅니다`}>
                                비우기
                              </button>
                            )}
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {aiSpends && <p className="muted-line ai-cost">AI의 특수 행동도 GM API를 씁니다(행동 하나에 호출 두 번). 비용이 걱정되면 "특수 행동 끔"으로 두세요.</p>}
              {online && (
                <>
                  <h3 className="bench-title">
                    대기석 <span className="muted">{bench.length}명</span>
                  </h3>
                  <ul className="members bench">
                    {bench.length === 0 && <li className="member empty">아무도 없습니다.</li>}
                    {bench.map((m) => (
                      <li key={m.key} className={`member ${m.online ? '' : 'offline'}`}>
                        <span className="member-name">
                          {m.name}
                          {m.key === view.myKey && <span className="member-tag">나</span>}
                          {m.host && <span className="member-tag">방장</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {online && me && (
                <label className="field name-field">
                  <span>내 이름</span>
                  <input
                    id="my-name"
                    value={name}
                    maxLength={NAME_MAX_LENGTH}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={commitName}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </label>
              )}
              <div className="gm-line">
                <span className="muted">GM:</span> {view.gmName}
                {host && (
                  <button className="link" onClick={onGmSettings}>
                    바꾸기
                  </button>
                )}
              </div>
            </section>

            <section className="waiting-section">
              <h2>게임 규칙</h2>
              {host ? (
                <div className="rules-form">
                  <label className="field">
                    <span>판</span>
                    <select value={rules.map} onChange={(e) => set({ map: e.target.value === 'hex3' ? 'hex3' : 'classic' })}>
                      <option value="classic">보통 체스판 (2인)</option>
                      <option value="hex3">육각 판 (3인)</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>수 제한시간</span>
                    <select value={rules.turnSeconds} onChange={(e) => set({ turnSeconds: Number(e.target.value) })}>
                      {TURN_SECONDS.map((s) => (
                        <option key={s} value={s}>
                          {secondsLabel(s)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>시간 초과 벌칙</span>
                    <select
                      value={rules.timeoutPenalty}
                      disabled={!rules.turnSeconds}
                      onChange={(e) => set({ timeoutPenalty: Number(e.target.value) })}
                    >
                      {TIMEOUT_PENALTIES.map((p) => (
                        <option key={p} value={p}>
                          AP {p} 차감 + 턴 넘어감
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>턴마다 받는 AP</span>
                    <select value={rules.apPerTurn} onChange={(e) => set({ apPerTurn: Number(e.target.value) })}>
                      {AP_PER_TURN.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>실패 후 다시 굴리기</span>
                    <select value={rules.rerollCost} onChange={(e) => set({ rerollCost: Number(e.target.value) })}>
                      {REROLL_COSTS.map((n) => (
                        <option key={n} value={n}>
                          {rerollLabel(n)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>혼돈</span>
                    <select value={rules.chaosChance} onChange={(e) => set({ chaosChance: Number(e.target.value) })}>
                      {CHAOS_CHANCES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="toggle-row">
                    <input type="checkbox" checked={rules.doodle} onChange={(e) => set({ doodle: e.target.checked })} />
                    <span>낙서 모드 (테이블과 보드에 그리고 메모하기)</span>
                  </label>
                  <ul className="rule-notes">
                    <li>시간은 내 차례에만 흐르고, GM이 판정하는 동안에는 멈춥니다.</li>
                    {rules.chaosChance > 0 && (
                      <li>혼돈: 라운드마다(양쪽이 한 번씩 두고 백의 차례가 시작될 때) {chaosLabel(rules.chaosChance)} 확률로 GM(API)이 기상천외한 사건을 지어내 일으킵니다. GM API 사용량이 늘어납니다.</li>
                    )}
                    {rules.chaosChance > 0 && !view.chaosReady && (
                      <li className="rule-warn">⚠ 지금 GM({view.gmName})은 API를 쓰지 않아서 혼돈이 일어나지 않습니다. GM을 Claude, OpenAI, Gemini 중 하나로 바꾸고 API 키를 넣어 주세요.</li>
                    )}
                  </ul>
                </div>
              ) : (
                <ul className="rules-summary">
                  {rulesSummary(rules).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  <li className="muted">규칙은 방장이 정합니다.</li>
                </ul>
              )}
            </section>
          </div>

          {online && (
            <section className="waiting-section waiting-chat">
              <h2>채팅</h2>
              <ol className="log chat" ref={chatRef}>
                {view.chat.length === 0 && <li className="hint">시작하기 전에 인사를 나눠 보세요.</li>}
                {view.chat.map((m) => (
                  <li key={m.id} className={`chat-line ${m.author === view.myKey ? 'mine' : ''}`}>
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
                <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="채팅 메시지" maxLength={CHAT_MAX_LENGTH} disabled={!connected} />
                <button type="submit" disabled={!connected || !chatText.trim()}>
                  보내기
                </button>
              </form>
            </section>
          )}

          <footer className="waiting-foot">
            {host ? (
              <>
                <button className="primary big" onClick={() => session.start()} disabled={!canStart}>
                  게임 시작
                </button>
                {!canStart && (
                  <span className="muted-line">{emptySeats.map((c) => SEAT_LABEL[c]).join('·')} 자리가 비어 있습니다. 사람이 앉거나 AI를 앉혀야 시작할 수 있습니다.</span>
                )}
              </>
            ) : (
              <span className="muted-line">
                {me?.role === 'spectator' ? '대기석에 있습니다. 빈 자리에 앉거나 그대로 관전할 수 있습니다. ' : ''}방장이 게임을 시작하기를 기다리는 중…
              </span>
            )}
          </footer>
        </div>
      </div>

      {showMenu && (
        <SettingsMenu
          onClose={() => setShowMenu(false)}
          gm={{ isAuthority: host, name: view.gmName, busy: view.gmBusy, onOpen: onGmSettings }}
          fullscreen={fullscreen}
        />
      )}
      <ConnectionOverlay connection={view.connection} onLeave={onLeave} />
    </div>
  );
}
