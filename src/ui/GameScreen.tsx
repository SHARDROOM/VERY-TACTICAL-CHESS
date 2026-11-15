import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Quaternion } from 'three';
import {
  AIR,
  findKing,
  hasAnyMove,
  isAir,
  isInCheck,
  legalTargets,
  opponent,
  parseMoveText,
  rankOf,
  squareName,
  DUEL_TIMING,
  canResist,
  clashMultiplier,
  clashWinChance,
  type Color,
  type Fx,
  type GameEvent,
  type GameState,
  type Outcome,
  type Piece,
  type PromotionType,
  type Square,
} from '../engine';
import { BoardScene, type CameraRequest } from '../scene/BoardScene';
import { COLOR_NAME, OUTCOME_LABEL, PIECE_NAME, REJECT_MESSAGE, describeEvents, score, type LogEntry, type LogTone } from './messages';
import { PrecedentList } from './PrecedentList';
import { josa } from './josa';
import { GmSettings, type GmConfig } from './GmSettings';
import { PieceInfo } from './PieceInfo';
import { SettingsMenu, useFullscreen } from './SettingsMenu';
import { playSfx } from '../audio/sfx';
import { successChance } from '../dice';
import { loadPhysics, simulateRoll, simulateRolls } from '../dice3d/simulate';
import { skinRotationFor } from '../dice3d/d20';
import type { ActiveRoll } from '../dice3d/DiceTray';
import { CHAT_MAX_LENGTH, timeLeft, type Session, type SessionView, type TurnTimer } from '../session/types';
import { ConnectionOverlay } from './ConnectionOverlay';
import { DoodleToolbar } from './DoodleToolbar';
import type { DoodleTool } from '../scene/DoodleLayer';
import { DOODLE_COLORS, type DoodleOp } from '../session/doodle';
import { clockText, rulesSummary } from './rules';
import { Icon } from './Icon';
import { PieceSilhouette } from './PieceSilhouette';
import { buildShow, directionsFor, exitFx, type Show } from './show';
import { reachOf } from './reach';
import { prefersReducedMotion, useStagingLook } from './stagingLook';
import type { FxShow } from '../scene/FxLayer';
import { duelLength, planDuel, simulateDuel, type DuelPlan, type DuelRun } from '../scene/duel';
import { runLength, simulateFalls, simulateRomp, type BoardRun, type Mover } from '../scene/boardPhysics';
import type { PieceDirection } from '../scene/pieceMotion';

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
  /** Its show (if any) has started. */
  staged?: boolean;
  /** How many of its clashes (합) have had their dice shown. */
  clashesShown?: number;
}

type ClashEvent = Extract<GameEvent, { type: 'clash' }>;

/** A show being played: the GM's staging, from `startedAt` (performance.now()). */
interface Playing {
  show: Show;
  startedAt: number;
  /** The effect the show (re)started at: 0, or the one after a clash's duel. */
  from: number;
  /** Flights in the show played as romps (the flung piece bowls others over), by effect. */
  romps: { effect: number; run: BoardRun }[];
}

/** A plain move played as a romp: the recording and when it started (performance.now() ms). */
interface Romp {
  run: BoardRun;
  start: number;
}

/** The pieces a plain move sends across the board (a castling king takes its rook along). */
function moversOf(ev: Extract<GameEvent, { type: 'moved' }>, board: GameState['board']): Mover[] {
  const piece = board[ev.from];
  if (!piece) return [];
  const movers: Mover[] = [{ id: piece.id, type: piece.type, from: ev.from, to: ev.to, mode: piece.type === 'knight' ? 'throw' : 'slide' }];
  if (ev.special?.kind === 'castle') {
    const rank = rankOf(ev.from);
    const [rf, rt] = ev.special.side === 'king' ? [7, 5] : [0, 3];
    const rook = board[rank * 8 + rf];
    if (rook) movers.push({ id: rook.id, type: rook.type, from: rank * 8 + rf, to: rank * 8 + rt, mode: 'slide' });
  }
  return movers;
}

/** The same flight on every screen: a seed from the move. */
const moveSeed = (turn: number, from: Square, to: Square) => turn * 4099 + from * 67 + to * 7 + 1;

/** Puppet directions for every piece a recording moves, from `start`. */
function puppets(run: BoardRun, start: number, into = new Map<string, PieceDirection>()): Map<string, PieceDirection> {
  for (const [id, frames] of run.tracks) {
    const d = into.get(id) ?? { motions: [], acts: [] };
    into.set(id, { ...d, puppet: { frames, steps: run.steps, dt: run.dt, start } });
  }
  return into;
}

/** A clash's duel on screen: who, the recorded fight, and when it starts (performance.now() ms). */
interface Duel {
  clash: ClashEvent;
  plan: DuelPlan;
  run: DuelRun;
  startedAt: number;
}

/** Where the camera looks from during a duel: beside the two, a little behind the attacker. */
function duelCamera(plan: DuelPlan, side: Color): [number, number, number, number, number, number] {
  const a = plan.attacker.stance;
  const d = plan.defender.home;
  const mid = a.clone().lerp(d, 0.5);
  const dir = d.clone().sub(a).setY(0).normalize();
  const s = side === 'white' ? 1 : -1;
  let px = -dir.z;
  let pz = dir.x;
  // Look from the player's own side of the fight.
  if (pz * s < 0 || (Math.abs(pz) < 0.2 && px < 0)) {
    px = -px;
    pz = -pz;
  }
  return [mid.x + px * 4.2 - dir.x * 0.6, 2.5, mid.z + pz * 4.2 - dir.z * 0.6, mid.x, 0.5, mid.z];
}

/** The GM's narration across the screen while (and a little after) a show plays. */
interface Caption {
  kind: Show['kind'];
  title: string;
  text: string;
  outcome: Outcome | null;
}

let nextLogId = 1;

/** Seconds between the dice result and the show, while the camera swings back to the board. */
const SHOW_LEAD_IN = 0.6;
/** How long the camera stays close after a duel, for the loser's end. */
const DUEL_AFTERMATH_MS = 1300;



/** A piece on the board or riding on one. */
function findPiece(board: GameState['board'], id: string): Piece | undefined {
  for (const p of board) {
    if (p?.id === id) return p;
    if (p?.rider?.id === id) return p.rider;
  }
  return undefined;
}

/** A piece's kind by id, on the board or beside it. */
function pieceName(game: GameState, id: string): string {
  const type = findPiece(game.board, id)?.type ?? game.captured?.find((p) => p.id === id)?.type;
  return type ? PIECE_NAME[type] : '기물';
}

/** A clash's deciding round: each side's die times its multiplier, the winner lit up. */
function ClashResult({ clash, name }: { clash: ClashEvent; name: (id: string) => string }) {
  const last = clash.rounds[clash.rounds.length - 1];
  if (!last) return null;
  const ties = clash.rounds.length - 1;
  const side = (who: 'attacker' | 'defender') => {
    const color = who === 'attacker' ? clash.attacker : opponent(clash.attacker);
    const roll = who === 'attacker' ? last.attack : last.defense;
    const mult = who === 'attacker' ? clash.attack : clash.defense;
    const id = who === 'attacker' ? clash.attackerId : clash.defenderId;
    return (
      <span className={`clash-side clash-${color}${clash.winner === who ? ' won' : ''}`}>
        <span className="clash-who">
          {COLOR_NAME[color]} {name(id)}
          {who === 'defender' && clash.shield ? ' (보호막)' : ''}
        </span>
        <span className="clash-score">{score(roll, mult)}</span>
      </span>
    );
  };
  return (
    <div className="clash-result" role="status">
      <span className="clash-title">합</span>
      {side('attacker')}
      <span className="clash-vs">대</span>
      {side('defender')}
      {ties > 0 && <span className="clash-ties">동점 {ties}번 끝에</span>}
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
  const homeSide: Color = seat === 'black' ? 'black' : 'white';
  const spectator = seat === 'spectator';

  const [selected, setSelected] = useState<Square | null>(null);
  const [hovered, setHovered] = useState<Square | null>(null);
  const [log, setLog] = useState<LogLine[]>(() => (startNotice ? [{ id: nextLogId++, text: startNotice, tone: 'warn' }] : []));
  const [text, setText] = useState('');
  const [camera, setCamera] = useState<CameraRequest>({ mode: 'side', side: homeSide, nonce: 0 });
  // Dev only: "x,y,z,tx,ty,tz" pins the camera there (for screenshots from odd angles).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __vtcCam?: (spec: string) => void };
    w.__vtcCam = (spec) => {
      const v = spec.split(',').map(Number);
      if (v.length === 6 && v.every(Number.isFinite)) setCamera((c) => ({ ...c, custom: v as CameraRequest['custom'], nonce: c.nonce + 1 }));
    };
    return () => {
      delete w.__vtcCam;
    };
  }, []);
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
  /** The doodle tool in hand (null: the pointer moves the camera and the pieces). */
  const [doodleTool, setDoodleTool] = useState<DoodleTool | null>(null);
  const lastTool = useRef<DoodleTool>({ kind: 'pen', color: DOODLE_COLORS[1], width: 0.06, noteText: '' });
  const onDoodle = useMemo(() => (op: DoodleOp) => session.doodle(op), [session]);
  /** The show on screen (null between shows), and the caption that goes with it. */
  const [stage, setStage] = useState<Playing | null>(null);
  const [duel, setDuel] = useState<Duel | null>(null);
  const [romp, setRomp] = useState<Romp | null>(null);
  const endDuel = useRef<(() => void) | null>(null);
  const lightRef = useRef(false);
  const [caption, setCaption] = useState<Caption | null>(null);
  const showTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const endShow = useRef<(() => void) | null>(null);
  const [unread, setUnread] = useState(0);
  const chatRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [chat.length, tab]);
  // The caption stays a moment after the show so it can be read to the end.
  useEffect(() => {
    if (!caption || stage) return;
    const t = setTimeout(() => setCaption(null), 2200 + 30 * caption.text.length);
    return () => clearTimeout(t);
  }, [caption, stage]);
  useEffect(() => () => showTimers.current.forEach(clearTimeout), []);
  /**
   * The roll being shown on the table, and the board as it was before it (kept on screen
   * until the die lands). `landed` flips when the die stops; `done` reveals the result.
   */
  const [dice, setDice] = useState<{ roll: number; outcome: Outcome | null; done: () => void; landed: boolean; clash?: ClashEvent } | null>(null);
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
    /** In hotseat, the camera swings to whoever moves next. */
    const swingCamera = ({ before, after }: Batch) => {
      if (seat === 'both' && after.status.kind === 'playing' && after.turn !== before.turn) {
        setCamera((c) => ({ ...c, side: after.turn, nonce: c.nonce + 1 }));
      }
    };

    /** Logs a batch of game events and reacts to them (the moment the board shows them). */
    const applyBatch = (batch: Batch, staged = false) => {
      const { events, before, after } = batch;
      const typeOf = (id: string) =>
        findPiece(before.board, id)?.type ??
        findPiece(after.board, id)?.type ??
        [...(before.falling ?? []), ...(after.falling ?? [])].find((f) => f.piece.id === id)?.piece.type ??
        after.captured?.find((p) => p.id === id)?.type;
      addLog(describeEvents(events, typeOf));
      const passed = events.some((ev) => ev.type === 'turnPassed');
      if (passed) playSfx('turn', { delay: 0.25 });
      if (events.some((ev) => ev.type === 'check')) playSfx('check', { delay: 0.45 });
      if (events.some((ev) => ev.type === 'specialProposed')) playSfx('ruling');
      if (events.some((ev) => ev.type === 'chaos')) playSfx('chaos');
      if (events.some((ev) => ev.type === 'timedOut')) playSfx('timeout');
      const exposed = events.find((ev) => ev.type === 'ownKingExposed');
      if (exposed) setWarning(`${COLOR_NAME[exposed.color]} 킹이 공격받는 위치에 놓였습니다.`);
      else if (passed) setWarning(null);
      const proposed = events.find((ev) => ev.type === 'specialProposed');
      if (proposed && (seat === 'both' || proposed.color === seat)) setText('');
      setSelected(null);
      // After a show, not in the middle of it.
      if (!staged) swingCamera(batch);
    };

    /**
     * Plays a show: the board steps through the effects one by one on its timeline, with the
     * GM's particle effects, shake and narration; then `done`. Skipping ends it at once.
     */
    const startShow = (show: Show, batch: Batch, done: () => void, from = 0, resumed = false, romps: Playing['romps'] = []) => {
      // After a roll the camera is still turning back from the dice: give it a moment.
      const lead = !resumed && batch.rolled ? SHOW_LEAD_IN : 0;
      const t0 = resumed ? show.timeline.effectStarts[from] ?? 0 : 0;
      setFrozen(show.steps[from]);
      setStage({ show, startedAt: performance.now() + (lead - t0) * 1000, from, romps });
      if (!resumed) setCaption({ kind: show.kind, title: show.title, text: show.caption, outcome: show.outcome });
      // A clash (합) stops the show at its effect for the dice and the duel, then it goes on from there.
      const next = show.clashes.find((c) => (resumed ? c.effect > from : c.effect >= from));
      const stopAt = next ? next.effect : show.effects.length;
      const at = (t: number) => (lead + t - t0) * 1000;
      const timers: ReturnType<typeof setTimeout>[] = [];
      for (let i = from; i < stopAt; i++) timers.push(setTimeout(() => setFrozen(show.steps[i + 1]), at(show.timeline.effectStarts[i])));
      const finish = () => {
        showTimers.current.forEach(clearTimeout);
        showTimers.current = [];
        endShow.current = null;
        setStage(null);
        swingCamera(batch);
        done();
      };
      if (next) {
        timers.push(
          setTimeout(() => {
            showTimers.current.forEach(clearTimeout);
            showTimers.current = [];
            endShow.current = null;
            setStage(null);
            const board = show.steps[next.effect].board;
            startClashRoll(next.clash, () => {
              setDice(null);
              startDuel(next.clash, board, () => startShow(show, batch, done, next.effect, true, romps));
            });
          }, at(show.timeline.effectStarts[next.effect])),
        );
      } else {
        // A little time after the last effect for pieces to land (and any romp to be over).
        const rompEnd = Math.max(0, ...romps.map((r) => (show.timeline.effectStarts[r.effect] ?? 0) + runLength(r.run)));
        timers.push(setTimeout(finish, at(Math.max(show.timeline.length, rompEnd)) + 500));
      }
      showTimers.current = timers;
      endShow.current = next ? null : finish;
    };

    /**
     * A clash's duel: the camera closes in beside the two, they fight it out (recorded physics),
     * the loser goes, and the camera goes back to where it was. Then `done`.
     */
    const startDuel = (clash: ClashEvent, board: GameState['board'], done: () => void) => {
      const plan = planDuel(clash, board, lightRef.current ? 2 : 6);
      if (!plan) return done();
      const still = prefersReducedMotion();
      if (!still) setCamera((c) => ({ ...c, custom: duelCamera(plan, c.side), nonce: c.nonce + 1 }));
      void simulateDuel(plan).then((run) => {
        const startedAt = performance.now() + (still ? 0 : DUEL_TIMING.camera) * 1000;
        setDuel({ clash, plan, run, startedAt });
        let over = false;
        const end = () => {
          if (over) return;
          over = true;
          clearTimeout(timer);
          endDuel.current = null;
          // The result goes on the board just before the recording ends, so each piece eases from
          // where the fight left it to where the rules put it (the loser shatters or flies off).
          done();
          setTimeout(() => setDuel(null), 450);
          // Then the camera pulls back to the player's view (whatever side that is by now).
          if (!still) setTimeout(() => setCamera((c) => (c.custom ? { ...c, custom: undefined, nonce: c.nonce + 1 } : c)), DUEL_AFTERMATH_MS);
        };
        const timer = setTimeout(end, startedAt - performance.now() + duelLength(run) * 1000 - 60);
        endDuel.current = () => {
          // Skipping: the fight is over at once.
          setDuel((d) => (d ? { ...d, startedAt: performance.now() - duelLength(d.run) * 1000 - 10 } : d));
          clearTimeout(timer);
          setTimeout(end, 30);
        };
      });
    };

    /**
     * A plain move as a romp: the piece is shoved (or flung) across the board, bowling over what
     * it meets; just before it is over the move goes on the board, and every piece eases back.
     */
    const startRomp = (batch: Batch, done: () => void) => {
      const ev = batch.events.find((e): e is Extract<GameEvent, { type: 'moved' }> => e.type === 'moved')!;
      const movers = moversOf(ev, batch.before.board);
      void simulateRomp({ board: batch.before.board, movers, terrain: batch.before.terrain, seed: moveSeed(batch.before.turnNumber, ev.from, ev.to) })
        .then((run) => {
          const start = performance.now();
          setRomp({ run, start });
          setTimeout(done, Math.max(0, runLength(run) * 1000 - 60));
          setTimeout(() => setRomp((r) => (r?.run === run ? null : r)), runLength(run) * 1000 + 450);
        })
        .catch(done);
    };

    /**
     * Pieces falling from the air: the same fall the authority simulated (same seed), played as
     * a recording; just before it is over the landing goes on the board.
     */
    const startFall = (batch: Batch, seed: number, done: () => void) => {
      const falling = batch.before.falling ?? [];
      if (!falling.length) return void setTimeout(done, 0);
      void simulateFalls({ board: batch.before.board, terrain: batch.before.terrain, falling, seed })
        .then(({ run }) => {
          const start = performance.now();
          setRomp({ run, start });
          setTimeout(done, Math.max(0, runLength(run) * 1000 - 60));
          setTimeout(() => setRomp((r) => (r?.run === run ? null : r)), runLength(run) * 1000 + 450);
        })
        .catch(() => setTimeout(done, 0));
    };

    /** The flights of a show (default and fly moves) as romps, simulated before it starts. */
    const prepareRomps = async (show: Show): Promise<Playing['romps']> => {
      if (prefersReducedMotion()) return [];
      const out: Playing['romps'] = [];
      for (const [i, e] of show.effects.entries()) {
        // A move in the air floats over the board: nothing on the ground to bowl over.
        if (e.type !== 'move' || isAir(e.from) || show.clashes.some((c) => c.effect === i)) continue;
        const style = show.staging?.beats.find((b) => b.effect === i)?.motion ?? 'default';
        const before = show.steps[i];
        const piece = before.board[e.from];
        // Into a pit, or a piece that is not there any more: the usual ways.
        if (!piece || (style !== 'default' && style !== 'fly') || !show.steps[i + 1].board.some((p) => p?.id === piece.id)) continue;
        const victim = before.board[e.to];
        try {
          const run = await simulateRomp({
            board: before.board,
            movers: [{ id: piece.id, type: piece.type, from: e.from, to: e.to, mode: 'throw' }],
            exclude: new Set(victim ? [victim.id] : []),
            terrain: before.terrain,
            seed: moveSeed(before.turnNumber, e.from, e.to) + i,
          });
          out.push({ effect: i, run });
        } catch {
          // No physics: the usual flight.
        }
      }
      return out;
    };

    /** Rolls the die on the table: simulate, look at the tray, then reveal via `done`. */
    const startRoll = (roll: number, outcome: Outcome, done: () => void) => {
      setDice({ roll, outcome, done, landed: false });
      setDiceRoll({ run: null, skin: new Quaternion(), outcome, skipped: false });
      lookAtDice();
      simulateRoll()
        .then((run) => setDiceRoll((r) => (r ? { ...r, run, skin: skinRotationFor(roll, run.final) } : r)))
        // Without physics, just show the number.
        .catch(() => setDice((d) => (d ? { ...d, landed: true } : d)));
    };

    /** A clash (합): both dice at once, each in its side's colour, showing the deciding round. */
    const startClashRoll = (clash: ClashEvent, done: () => void) => {
      const last = clash.rounds[clash.rounds.length - 1] ?? { attack: 1, defense: 1 };
      const defender = clash.attacker === 'white' ? 'black' : 'white';
      setDice({ roll: last.attack, outcome: null, done, landed: false, clash });
      setDiceRoll({ run: null, skin: new Quaternion(), outcome: null, skipped: false, second: { run: null, skin: new Quaternion() }, tints: [clash.attacker, defender] });
      lookAtDice();
      simulateRolls(2)
        .then(([a, d]) =>
          setDiceRoll((r) => (r ? { ...r, run: a, skin: skinRotationFor(last.attack, a.final), second: { run: d, skin: skinRotationFor(last.defense, d.final) } } : r)),
        )
        .catch(() => setDice((x) => (x ? { ...x, landed: true } : x)));
    };

    const lookAtDice = () =>
      setCamera((c) => {
        if (c.mode !== 'dice') cameraBeforeDice.current = c;
        return { ...c, mode: 'dice', nonce: c.nonce + 1 };
      });

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
        // A clash (합) in a normal move: its dice, then the duel, before anything moves. (A special
        // action's clashes play inside its show, where its effect comes.)
        const clashes = resolved ? [] : head.events.filter((ev): ev is ClashEvent => ev.type === 'clash');
        if ((head.clashesShown ?? 0) < clashes.length) {
          const clash = clashes[head.clashesShown ?? 0];
          head.clashesShown = (head.clashesShown ?? 0) + 1;
          setFrozen(head.before);
          startClashRoll(clash, () => {
            setDice(null);
            startDuel(clash, head.before.board, pump);
          });
          return;
        }
        // Pieces falling from the air come down as the physics has it.
        const fell = head.events.find((ev): ev is Extract<GameEvent, { type: 'fell' }> => ev.type === 'fell');
        if (fell && !head.staged) {
          head.staged = true;
          setFrozen(head.before);
          startFall(head, fell.seed, () => {
            queue.shift();
            applyBatch(head);
            pump();
          });
          return;
        }
        if (!head.staged) {
          head.staged = true;
          const show = buildShow(head.events, head.before, (o) => OUTCOME_LABEL[o]);
          if (show && show.timeline.length > 0) {
            applyBatch(head, true);
            setFrozen(show.steps[0]);
            void prepareRomps(show).then((romps) =>
              startShow(
                show,
                head,
                () => {
                  queue.shift();
                  pump();
                },
                0,
                false,
                romps,
              ),
            );
            return;
          }
          // A plain move: a romp across the board (unless the device asks for less motion).
          // (In the air there is nothing to bowl over: it just floats across.)
          const plain =
            !show &&
            !resolved &&
            head.events.some((ev) => ev.type === 'moved' && !isAir(ev.from)) &&
            !head.events.some((ev) => ev.type === 'clash' || ev.type === 'chaos');
          if (plain && !prefersReducedMotion()) {
            setFrozen(head.before);
            startRomp(head, () => {
              queue.shift();
              applyBatch(head);
              pump();
            });
            return;
          }
          // Nothing to watch (e.g. a plain failure): the narration still gets its moment.
          if (show) setCaption({ kind: show.kind, title: show.title, text: show.caption, outcome: show.outcome });
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
  // "Light" staging: fewer particles and no shake; a device asking for less motion never shakes.
  const look = useStagingLook();
  lightRef.current = look === 'light';
  const fxShow = useMemo<FxShow | null>(() => {
    if (duel) {
      // Sparks where they meet; a burst of light when a shield breaks.
      const { run, clash, startedAt } = duel;
      const point: [number, number] = [run.contact.x, run.contact.z];
      const fx = run.hits.map((h): Fx => ({ element: 'impact', shape: 'burst', at: clash.at, to: null, radius: 0.35 + 0.35 * h.strength, strength: h.final ? 4 : 2, duration: 0.45, withEffect: null, delay: 0 }));
      const final = run.hits.find((h) => h.final);
      if (final && duel.plan.finale === 'shield') fx.push({ element: 'light', shape: 'burst', at: clash.at, to: null, radius: 0.8, strength: 3, duration: 0.8, withEffect: null, delay: 0 });
      const starts = [...run.hits.map((h) => h.t), ...(fx.length > run.hits.length ? [final!.t] : [])];
      return {
        fx,
        starts,
        ends: starts.map((t, i) => t + fx[i].duration),
        startedAt,
        followers: fx.map(() => null),
        points: fx.map((f) => (f.element === 'impact' ? point : null)),
        light: look === 'light',
      };
    }
    if (!stage) return null;
    const { show, startedAt, from } = stage;
    // Picking up after a duel: only what is still to come.
    const resumeAt = from > 0 ? show.timeline.effectStarts[from] ?? 0 : 0;
    const fx = show.staging?.fx ?? [];
    const exits = exitFx(show);
    const all = {
      fx: [...fx, ...exits.map((x) => x.fx)],
      starts: [...show.timeline.fxStarts, ...exits.map((x) => x.start)],
      ends: [...show.timeline.fxEnds, ...exits.map((x) => x.end)],
      followers: [...fx.map((f) => (f.shape === 'trail' && f.withEffect !== null ? (show.movers[f.withEffect] ?? null) : null)), ...exits.map((x) => x.follower)],
    };
    const keep = all.starts.map((t) => t >= resumeAt - 0.01);
    return {
      fx: all.fx.filter((_, i) => keep[i]),
      starts: all.starts.filter((_, i) => keep[i]),
      ends: all.ends.filter((_, i) => keep[i]),
      followers: all.followers.filter((_, i) => keep[i]),
      startedAt,
      light: look === 'light',
    };
  }, [stage, duel, look]);
  // What each piece does in the show (how it travels, appears, acts) or in a duel; hand moves have nothing.
  const directions = useMemo(() => {
    if (duel) {
      const { run } = duel;
      const fight = (frames: Float32Array): PieceDirection => ({ motions: [], acts: [], puppet: { frames, steps: run.steps, dt: run.dt, start: duel.startedAt } });
      return new Map([
        [duel.plan.attackerId, fight(run.attacker)],
        [duel.plan.defenderId, fight(run.defender)],
      ]);
    }
    if (romp) return puppets(romp.run, romp.start);
    if (!stage) return undefined;
    const base = directionsFor(stage.show, stage.startedAt, stage.from);
    for (const r of stage.romps) {
      if (r.effect < stage.from) continue;
      puppets(r.run, stage.startedAt + (stage.show.timeline.effectStarts[r.effect] ?? 0) * 1000, base);
    }
    return base;
  }, [stage, duel, romp]);
  const shake = useMemo(() => {
    if (look === 'light' || prefersReducedMotion()) return null;
    if (duel) {
      const final = duel.run.hits.find((h) => h.final);
      return final ? { at: duel.startedAt + final.t * 1000, strength: 1 } : null;
    }
    const strength = stage?.show.staging?.shake ?? 0;
    const at = stage?.show.timeline.shakeAt ?? null;
    if (!stage || !strength || at === null) return null;
    return { at: stage.startedAt + at * 1000, strength };
  }, [stage, duel, look]);
  const targets = useMemo(() => (selected === null ? [] : legalTargets(game, selected).map((t) => t.to)), [game, selected]);
  // Captures that would be clashes (합), with the selected piece's chance of winning each.
  const clashOdds = useMemo(() => {
    const mover = selected === null ? null : game.board[selected];
    if (selected === null || !mover) return [];
    return legalTargets(game, selected).flatMap((t) => {
      const victimSq = t.special?.kind === 'enPassant' ? t.to + (mover.color === 'white' ? -8 : 8) : t.to;
      const victim = game.board[victimSq];
      if (!victim || victim.color === mover.color || !canResist(victim)) return [];
      const attack = clashMultiplier(mover);
      const defense = clashMultiplier(victim);
      return [{ at: t.to, attack, defense, shield: !!victim.tags?.some((g) => g.name === '보호막'), chance: clashWinChance(attack, defense) }];
    });
  }, [game, selected]);

  const sideToMove = game.turn;
  const playing = game.status.kind === 'playing';
  const myTurn = seat === 'both' || seat === sideToMove;
  const inCheck = playing && isInCheck(game.board, sideToMove, game.terrain);
  const checkedKing = inCheck ? findKing(game.board, sideToMove) : null;
  const pending = game.pending;
  // Who acts on what, on the sheet and on the board, while the ruling waits.
  const reach = useMemo(() => (pending ? reachOf(pending.ruling, game.board) : null), [pending, game.board]);
  const marks = useMemo(() => (reach && !stage ? { actor: reach.actor, targets: reach.targets.map((t) => t.at) } : null), [reach, stage]);
  const connected = view.connection.kind === 'local' || view.connection.kind === 'hosting' || view.connection.kind === 'connected';
  const locked = !playing || view.gmBusy || !!pending || !myTurn || !connected || !!dice || !!stage || !!duel || !!romp;
  // A turn has to be used for something: a normal move ends it by itself, so passing is only
  // for after a special action (or when no piece can move at all).
  const canEndTurn = game.usedApThisTurn || !hasAnyMove(game);
  const winner = game.status.kind === 'won' ? game.status.winner : null;

  const promotes = (from: Square, to: Square) => {
    const mover = game.board[from];
    return mover?.type === 'pawn' && rankOf(to) === (mover.color === 'white' ? 7 : 0);
  };

  const onSquareClick = (sq: Square) => {
    if (locked || doodleTool) return;
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
    let parsed = parseMoveText(input);
    // "d4d5" for a piece floating above d4 (nothing of ours on the ground there) means the air.
    if (parsed && !isAir(parsed.from) && game.board[parsed.from]?.color !== sideToMove && game.board[parsed.from + AIR]?.color === sideToMove) {
      parsed = { ...parsed, from: parsed.from + AIR, to: isAir(parsed.to) ? parsed.to : parsed.to + AIR };
    }
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

  // After a failed roll the same ruling can be rolled again, for the room's reroll price.
  const retry = pending?.retry;
  const rollCost = pending ? (retry ? game.rules.rerollCost : pending.ruling.cost) : 0;
  const canAfford = pending ? game.ap[pending.color] >= rollCost : false;
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
        terrain={game.terrain}
        marks={marks}
        falling={game.falling}
        clashOdds={locked ? undefined : clashOdds}
        directions={directions}
        fx={fxShow}
        shake={shake}
        lightFx={look === 'light'}
        doodle={
          game.rules.doodle
            ? { doodles: view.doodles, tool: doodleTool, myKey: view.myKey, moderator: view.isAuthority, onDoodle }
            : undefined
        }
      />

      <div className="hud topbar">
      <header className="top">
        <div className={`turn turn-${winner ?? sideToMove}`}>
          <span className="turn-token" aria-hidden />
          <span className="turn-text">{winner ? `${COLOR_NAME[winner]} 승리` : `${COLOR_NAME[sideToMove]}의 차례`}</span>
          {online && !winner && nameOf(sideToMove) && <span className="turn-name">{nameOf(sideToMove)}</span>}
          <span className="turn-number">{game.turnNumber}턴</span>
        </div>
        {view.timer && playing && !frozen && <TimerBadge timer={view.timer} mine={myTurn && !spectator} />}
        {(seat === 'white' || seat === 'black') && online && <div className={`badge me me-${seat}`}>나: {COLOR_NAME[seat]}</div>}
        {spectator && <div className="badge me">관전 중</div>}
        {online && watchers > 0 && <div className="badge muted-badge">관전 {watchers}명</div>}
        {inCheck && <div className="badge check">체크!</div>}
        {view.gmBusy && <div className="badge busy">GM 판정 중…</div>}
        {warning && !winner && <div className="badge warn">⚠ {warning}</div>}
        {absent && playing && <div className="badge warn">{absent.name}님 연결 끊김, 다시 들어오기를 기다리는 중</div>}
      </header>


      <nav className="tools" aria-label="테이블 도구">
        <button onClick={resetView} title="내 쪽에서 비스듬히 보는 시점으로" aria-label="시점 초기화">
          <Icon name="reset" />
          <span className="tool-label">시점 초기화</span>
        </button>
        <button onClick={toggleTopView} aria-label={camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'} title={camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'}>
          <Icon name={camera.mode === 'top' ? 'side' : 'top'} />
          <span className="tool-label">{camera.mode === 'top' ? '비스듬히 보기' : '위에서 보기'}</span>
        </button>
        {game.rules.doodle && (
          <button
            className={doodleTool ? 'active' : ''}
            onClick={() => setDoodleTool((t) => (t ? null : lastTool.current))}
            title="테이블과 보드에 그리거나 메모하기"
            aria-label="낙서"
            aria-pressed={!!doodleTool}
          >
            <Icon name="pencil" />
            <span className="tool-label">낙서</span>
          </button>
        )}
        <button onClick={() => setShowPrecedents(true)} title="지금까지의 GM 판정 기록" aria-label={`판례 ${game.precedents.length}개`}>
          <Icon name="scroll" />
          <span className="tool-label">판례</span>
          <span className="tool-count">{game.precedents.length}</span>
        </button>
        <button className="menu-button" onClick={() => setShowMenu(true)} aria-haspopup="menu" title="설정" aria-label="설정">
          <Icon name="gear" />
          <span className="tool-label">설정</span>
        </button>
      </nav>
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
                    ? '진짜 GM은 설정에서 Claude, OpenAI, Gemini 중 하나의 API 키를 넣으면 켜집니다.'
                    : 'GM은 방장이 설정합니다.'}
                  {view.isAuthority && game.rules.chaosChance > 0 && !view.chaosReady && (
                    <>
                      <br />⚠ 혼돈이 켜져 있지만 지금 GM은 API를 쓰지 않아서 혼돈이 일어나지 않습니다.
                    </>
                  )}
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
          <article className="ruling-sheet" aria-labelledby="ruling-title">
            <div className="ruling-who">{COLOR_NAME[pending.color]}{online && nameOf(pending.color) ? `(${nameOf(pending.color)})` : ''}의 선언</div>
            <blockquote>“{pending.action}”</blockquote>
            {retry && (
              <div className="retry-note">
                <div className="retry-roll">
                  🎲 {retry.roll} 실패{retry.rerolls ? ` (다시 굴림 ${retry.rerolls}번째)` : ''}
                </div>
                {retry.narration && <p className="retry-narration">{retry.narration}</p>}
              </div>
            )}
            <div className="ruling-body">
              <h2 id="ruling-title">GM 판정</h2>
              <p className="ruling-text">{pending.ruling.interpretation}</p>
              {reach && (
                <p className="ruling-reach">
                  <span className="reach-actor">
                    {squareName(reach.actor)} {reach.piece ? PIECE_NAME[reach.piece.type] : ''}
                  </span>
                  {reach.means && <span className="reach-means">{reach.means}</span>}
                  {reach.targets.length > 0 && (
                    <span className="reach-arrow" aria-hidden>
                      →
                    </span>
                  )}
                  {reach.targets.length > 0 && (
                    <span className="reach-targets">
                      {reach.targets.slice(0, 3).map((t) => `${squareName(t.at)} ${t.d}칸`).join(', ')}
                      {reach.targets.length > 3 ? ' …' : ''}
                    </span>
                  )}
                </p>
              )}
              {pending.ruling.feasible && (
                <div className="seal" role="img" aria-label={`난이도 DC ${pending.ruling.dc}`}>
                  <span className="seal-label">DC</span>
                  <span className="seal-number">{pending.ruling.dc}</span>
                </div>
              )}
            </div>
            {pending.ruling.feasible ? (
              <>
                <D20Odds dc={pending.ruling.dc} />
                <dl className="ruling-facts">
                  <div>
                    <dt>{retry ? '다시 굴리는 비용' : '비용'}</dt>
                    <dd>
                      {Array.from({ length: rollCost }, (_, i) => (
                        <span key={i} className="coin" aria-hidden />
                      ))}
                      AP {rollCost}
                    </dd>
                  </div>
                  <div>
                    <dt>성공 확률</dt>
                    <dd>{Math.round(successChance(pending.ruling.dc) * 100)}%</dd>
                  </div>
                </dl>
                <ul className="crit-notes">
                  <li>20이 나오면 대성공: {pending.ruling.critSuccessEffects?.length ? '성공보다 더 좋은 결과가 납니다.' : '성공과 같은 결과입니다.'}</li>
                  <li>1이 나오면 대실패: {pending.ruling.critFailureEffects?.length ? '역효과가 있습니다.' : '아무 일도 일어나지 않습니다.'}</li>
                </ul>
                {!canAfford && <p className="infeasible">AP가 부족해서 {retry ? '다시 굴릴' : '시도할'} 수 없습니다.</p>}
              </>
            ) : (
              <p className="infeasible">GM이 불가능한 행동으로 판정했습니다.</p>
            )}
            {canActOnPending ? (
              <div className="choice-row">
                <button className="primary" onClick={() => session.request({ type: 'attempt' })} disabled={!pending.ruling.feasible || !canAfford}>
                  {retry ? `다시 굴리기 (AP ${rollCost})` : '주사위 굴리기'}
                </button>
                <button onClick={() => session.request({ type: 'cancel' })}>{retry ? '그만두기' : '취소 (AP는 그대로)'}</button>
              </div>
            ) : (
              <p className="muted-line">
                {spectator ? `${josa(COLOR_NAME[pending.color], '이/가')} ` : '상대가 '}
                {retry ? '다시 굴릴지' : '굴릴지'} 정하는 중입니다…
              </p>
            )}
          </article>
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
            <p>폰이 끝줄에 닿았습니다. 무엇으로 바꿀까요?</p>
            <div className="promo-row">
              {(['queen', 'rook', 'bishop', 'knight'] as const).map((t) => (
                <button key={t} className="promo" onClick={() => promote(t)}>
                  <PieceSilhouette type={t} color={game.board[promotionChoice.from]?.color ?? 'white'} />
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

      {doodleTool && game.rules.doodle && (
        <DoodleToolbar
          tool={doodleTool}
          onTool={(t) => {
            lastTool.current = t;
            setDoodleTool(t);
          }}
          onClose={() => setDoodleTool(null)}
          doodles={view.doodles}
          myKey={view.myKey}
          moderator={view.isAuthority}
          onDoodle={onDoodle}
        />
      )}

      <ConnectionOverlay connection={view.connection} onLeave={onLeave} />

      {caption && !dice && (
        <div className={`hud show-caption show-${caption.kind} ${caption.outcome ?? ''}`} role="status">
          <div className="show-head">
            <span className="show-title">{caption.kind === 'chaos' ? `🌪 혼돈! ${caption.title}` : caption.title}</span>
            {stage ? (
              <button className="show-skip" onClick={() => endShow.current?.()}>
                건너뛰기
              </button>
            ) : (
              <button className="link show-close" onClick={() => setCaption(null)}>
                닫기
              </button>
            )}
          </div>
          {caption.text && <p className="show-text">{caption.text}</p>}
        </div>
      )}

      {duel && (
        <div className="hud dice-hud duel-hud" role="status">
          <span className="clash-title">합</span>
          <span className="duel-who">
            {COLOR_NAME[duel.clash.attacker]} {pieceName(game, duel.clash.attackerId)} 대 {COLOR_NAME[opponent(duel.clash.attacker)]} {pieceName(game, duel.clash.defenderId)}
          </span>
          <button onClick={() => endDuel.current?.()}>건너뛰기</button>
        </div>
      )}

      {dice && (
        <div className="hud dice-hud">
          {dice.landed && dice.clash ? (
            <ClashResult clash={dice.clash} name={(id) => pieceName(game, id)} />
          ) : dice.landed && dice.outcome ? (
            <div className={`dice-result ${dice.outcome}`}>
              <span className="dice-number">{dice.roll}</span>
              <span className="dice-label">{OUTCOME_LABEL[dice.outcome]}</span>
            </div>
          ) : (
            <div className="dice-rolling">{dice.clash ? '⚔ 합! 주사위를 굴리는 중…' : '🎲 주사위를 굴리는 중…'}</div>
          )}
          <button onClick={dice.landed ? finishRoll : skipRoll}>{dice.landed ? '확인' : '건너뛰기'}</button>
        </div>
      )}

      {winner && connected && !dice && (
        <div className="overlay">
          <div className={`victory victory-${winner}`}>
            <span className="victory-stone" aria-hidden />
            <h1>{COLOR_NAME[winner]} 승리</h1>
            {online && nameOf(winner) && <div className="victory-name">{nameOf(winner)}</div>}
            <p className="victory-how">{COLOR_NAME[opponent(winner)]} 킹이 잡혔습니다.</p>
            <p className="victory-recap">{recap(game)}</p>
            <div className="victory-actions">
              {view.isAuthority ? (
                <button className="primary" onClick={restart}>
                  대기실로 돌아가기
                </button>
              ) : (
                <p className="muted-line">방장이 대기실로 돌아가면 새 게임을 준비합니다.</p>
              )}
              {online && <button onClick={onLeave}>방에서 나가기</button>}
            </div>
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

/** The twenty faces of the die, marking which of them succeed against this DC. */
function D20Odds({ dc }: { dc: number }) {
  const faces = Array.from({ length: 20 }, (_, i) => i + 1);
  const kind = (n: number) => (n === 20 ? 'crit' : n === 1 ? 'fumble' : n >= dc ? 'win' : '');
  return (
    <div className="odds">
      <div className="odds-faces" aria-hidden>
        {faces.map((n) => (
          <span key={n} className={`odds-face ${kind(n)}`}>
            {n}
          </span>
        ))}
      </div>
      <div className="odds-caption">d20에서 {Math.min(dc, 20)} 이상이면 성공{dc > 20 ? ' (20만 성공)' : ''}</div>
    </div>
  );
}

/** One sentence about how the game went. */
function recap(game: GameState): string {
  const specials = game.precedents.length;
  const crits = game.precedents.filter((p) => p.outcome === 'critSuccess').length;
  const fumbles = game.precedents.filter((p) => p.outcome === 'critFailure').length;
  const chaos = game.chaosLog?.length ?? 0;
  const parts: string[] = [];
  if (specials) {
    const extra = [crits && `대성공 ${crits}번`, fumbles && `대실패 ${fumbles}번`].filter(Boolean).join(', ');
    parts.push(`특수 행동 ${specials}번${extra ? `(${extra})` : ''}`);
  }
  if (chaos) parts.push(`혼돈 ${chaos}번`);
  const turns = `${game.turnNumber}턴 만에 끝났습니다.`;
  return parts.length ? `${turns} ${parts.join(', ')}이 있었습니다.` : `${turns} 특수 행동 없이 체스 실력만으로 끝났습니다.`;
}
