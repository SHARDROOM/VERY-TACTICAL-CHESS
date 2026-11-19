import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';

/*
 * The rule book on the title screen's table ("이 게임이 매우 전략적인 이유"): what each page
 * says, and how a page is painted (parchment, ink, a frame) into a texture. The book itself (its
 * leaves and their physics) is RuleBook.tsx.
 */

type Block =
  | { h2: string }
  | { p: string }
  | { li: string }
  | { note: string }
  | { rows: [string, string][] }
  | { big: string };

export interface PageText {
  title: string;
  blocks: Block[];
}

/**
 * The faces in reading order: the inside of the front cover, then each sheet's front and back,
 * then the inside of the back cover (8 in all, for 3 sheets).
 */
export const BOOK_PAGES: PageText[] = [
  {
    title: '이 게임이 매우 전략적인 이유',
    blocks: [
      { p: '체스의 규칙 위에, 말로 하는 모든 행동이 더해집니다. 무엇이든 선언하면 GM이 난이도를 정하고, 주사위 두 개가 결과를 냅니다.' },
      { p: '이 책은 그 판정이 어떻게 굴러가는지를 담았습니다.' },
      { h2: '차례' },
      { li: '1  AP: 작전 포인트' },
      { li: '2  판정과 주사위' },
      { li: '3  보정: 주사위에 더해지는 것' },
      { li: '4  합: 잡으려 하면 싸운다' },
      { li: '5  판정을 잘 받는 법' },
      { li: '6  태그 사전' },
      { li: '7  건물과 혼돈' },
    ],
  },
  {
    title: 'AP: 작전 포인트',
    blocks: [
      { li: '턴이 시작될 때마다 AP를 받습니다. 기본 1, 최대 5까지 쌓입니다.' },
      { li: '일반 수에는 AP가 들지 않습니다. 특수 행동만 AP를 씁니다(1~2).' },
      { li: '주사위를 굴리는 순간 비용을 냅니다. 판정을 보고 굴리지 않으면 AP는 그대로입니다.' },
      { li: '실패하면 AP 1로 한 번 더 굴릴 수 있습니다.' },
      { li: '특수 행동 뒤에도 같은 턴에 일반 수를 둘 수 있습니다. 다만 그 턴에는 킹을 잡을 수 없습니다.' },
      { li: '턴은 무언가를 해야 끝납니다. 수를 두거나 특수 행동을 시도하세요.' },
      { li: '수 제한시간을 넘기면 AP를 잃고 턴이 넘어갑니다.' },
      { note: 'AP는 5에서 멈춥니다. 아끼기만 하면 넘쳐서 버려집니다.' },
    ],
  },
  {
    title: '판정과 주사위',
    blocks: [
      { p: '선언은 한국어 한 문장입니다. GM이 누가(주체), 어떻게(수단), 무엇을 하는지 읽고 DC와 AP 비용을 정합니다.' },
      { li: '주사위 두 개의 합 + 보정이 DC 이상이면 성공.' },
      { li: '1·1은 보정과 상관없이 대실패. 역효과가 일어납니다.' },
      { rows: [['DC 5', '83%'], ['DC 6', '72%'], ['DC 7', '58%'], ['DC 8', '42%'], ['DC 9', '28%'], ['DC 10', '17%'], ['DC 11', '8%']] },
      { li: '주체는 내 기물이어야 하고, 기절한 기물은 행동하지 못합니다.' },
      { li: '수단: 근접(1칸 안), 원거리, 마법, 이동.' },
      { note: '이미 내린 판정(판례)과 비슷한 선언은 비슷한 DC를 받습니다.' },
    ],
  },
  {
    title: '보정: 주사위에 더해지는 것',
    blocks: [
      { p: '시스템이 계산해 판정 창에 출처와 함께 보여 줍니다. 모두 합쳐 ±4까지.' },
      { li: '거리: 근접·이동은 2칸부터 2칸마다 −1, 원거리는 3칸부터 2칸마다 −1, 마법은 4칸부터 3칸마다 −1.' },
      { li: '특기: 그 행동을 잘하는 태그가 있으면 +1~+3.' },
      { li: '정신력: 회유·공포 같은 정신 행동은 대상의 의지만큼 빠집니다.' },
      { li: '희생: 주체 옆 내 기물을 바치면 폰 +1, 나이트·비숍 +2, 룩 +3, 퀸 +4. 합 배율을 얻으려고 바치면 1점마다 배율 +0.1, 보정은 1/3.' },
      { li: '유해: 쓰러진 자리에서 되살리면 +2 (3턴 동안).' },
      { li: '건물: 1칸 안의 건물이 행동에 맞으면 +1~+3.' },
    ],
  },
  {
    title: '합: 잡으려 하면 싸운다',
    blocks: [
      { p: '배율 태그나 보호막이 있는 기물을 잡으려 하면 합이 벌어집니다.' },
      { li: '양쪽이 주사위 두 개의 합 × 배율을 겨뤄 큰 쪽이 이깁니다(같으면 다시).' },
      { li: '공격 쪽이 지면 공격한 기물이 잡힙니다.' },
      { rows: [['폰', '×0.8'], ['나이트 · 비숍', '×1'], ['룩', '×1.2'], ['퀸', '×1.6']] },
      { li: '태그 배율은 곱합니다. 검술 ×1.5인 폰은 ×1.2.' },
      { li: '보호막은 지면 깨지기만 하고 기물은 남습니다.' },
      { li: '배율이 있는 기물은 즉사(찌르기, 저격, 주문)도 합이 됩니다. 근접으로 지면 쓰러지고, 원거리·마법으로 지면 빗나갈 뿐입니다.' },
      { note: '폰(×0.8)이 검술 룩(×1.8)을 이길 확률은 7%. 기절이나 보호막 깨기가 답일 때도 있습니다.' },
    ],
  },
  {
    title: '판정을 잘 받는 법',
    blocks: [
      { li: '주체 칸을 맨 앞에: "e4 나이트가 …"' },
      { li: '대상과 가까운 기물로. 거리는 그대로 주사위에서 빠집니다.' },
      { li: '기물답게: 비숍은 주문, 나이트는 돌진, 룩은 투석기.' },
      { li: '1턴짜리 효과는 영구보다 쉽고 쌉니다.' },
      { li: '건물 옆에서, 특기를 살려서.' },
      { li: '큰일에는 희생을. 바친 만큼 버프 한도도 커집니다.' },
      { li: '깃펜(입력 도움)으로 기물과 칸을 눌러 쓰면 칸을 틀리지 않습니다.' },
      { li: '판정이 마음에 들지 않으면 굴리지 마세요. AP는 그대로입니다.' },
    ],
  },
  {
    title: '태그 사전',
    blocks: [
      { li: '기절: 움직이지도, 공격하지도 못함.' },
      { li: '보호막: 잡힘을 한 번 막음.' },
      { li: '화상: 정해진 턴 안에 칸을 옮기지 않으면 타서 사라짐.' },
      { li: '공중부양: 공중 칸으로 떠오름. 끝나면 추락.' },
      { li: '혼란: 턴 끝마다 빈칸으로 비틀거림.' },
      { li: '행동대장: 턴 끝마다 자신과 옆 동료 중 최선의 한 수.' },
      { li: '원호: 옆 동료 대신 잡힘.' },
      { li: '인질: 못 움직이고, 잡은 기물 대신 죽음.' },
      { li: '검술 같은 배율 태그: 합 실력.' },
      { li: '이동 능력: 다른 기물처럼, 또는 연속으로.' },
      { li: '특기 · 정신력: 주사위 보정.' },
    ],
  },
  {
    title: '건물과 혼돈',
    blocks: [
      { p: '건물은 벽처럼 길을 막지만, 옆에서 하는 행동을 돕습니다. 누구의 건물이든 쓸 수 있습니다.' },
      { li: '대포: 원거리 공격 · 교회: 되살리기 · 대장간: 무기.' },
      { li: '짓기도 특수 행동입니다(DC 8~9, AP 2).' },
      { p: '혼돈을 켜면 라운드가 시작될 때 확률로 GM이 사건을 일으킵니다. 회색 떠돌이는 누구의 편도 아닙니다.' },
      { big: '이제 판으로 돌아가 선언하세요.' },
    ],
  },
];

/** Page textures are this many pixels (the page's 2.4 × 3.2 shape). */
const TEX_W = 1024;
const TEX_H = 1365;
/** Pages are painted this much finer than their layout units (small print stays sharp up close). */
const PAGE_SCALE = 1.5;

const VOICE = '"Hahmlet Variable", "Nanum Myeongjo", serif';
/** Body text: the book's serif at a sturdy weight, dark ink (thin strokes wash out on paper in 3D). */
const BODY = 520;
const INK = '#1c1209';

/** Waits for the book's fonts (they come with the app, but load lazily). */
export async function bookFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`700 52px ${VOICE}`, '이유'),
    document.fonts.load(`${BODY} 36px ${VOICE}`, '판정'),
  ]).catch(() => {});
}

/** Splits text into lines that fit `width` (by words, and by letters when a word is too long). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const tryLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(tryLine).width <= width) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= width) {
      line = word;
      continue;
    }
    // A word wider than the page: by letters.
    line = '';
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > width) {
        lines.push(line);
        line = ch;
      } else line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Aged paper: warm, darker towards the edges, a few specks, and a thin ruled frame. */
function paper(ctx: CanvasRenderingContext2D, seed: number, dark = false) {
  const g = ctx.createRadialGradient(TEX_W / 2, TEX_H / 2, TEX_H * 0.2, TEX_W / 2, TEX_H / 2, TEX_H * 0.75);
  g.addColorStop(0, dark ? '#e7d2a6' : '#f4e7c8');
  g.addColorStop(1, dark ? '#c9ad78' : '#dcc596');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(120, 84, 40, ${0.04 + rnd() * 0.06})`;
    const r = 0.6 + rnd() * 1.8;
    ctx.beginPath();
    ctx.arc(rnd() * TEX_W, rnd() * TEX_H, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(110, 72, 34, 0.55)';
  ctx.lineWidth = 3;
  ctx.strokeRect(46, 46, TEX_W - 92, TEX_H - 92);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(58, 58, TEX_W - 116, TEX_H - 116);
  // Small diamonds at the frame's corners.
  ctx.fillStyle = 'rgba(110, 72, 34, 0.7)';
  for (const [x, y] of [[52, 52], [TEX_W - 52, 52], [52, TEX_H - 52], [TEX_W - 52, TEX_H - 52]]) {
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x + 12, y);
    ctx.lineTo(x, y + 12);
    ctx.lineTo(x - 12, y);
    ctx.closePath();
    ctx.fill();
  }
}

/** Lays a page's text out at `size` (body px); returns the drawing, or null if it does not fit. */
function layout(ctx: CanvasRenderingContext2D, page: PageText, size: number, draw: boolean): boolean {
  const left = 100;
  const width = TEX_W - left * 2;
  const bottom = TEX_H - 150;
  let y = 150;
  const line = Math.round(size * 1.5);
  // Title, centred, with a rule under it.
  ctx.fillStyle = '#3b2414';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${Math.round(size * 1.45)}px ${VOICE}`;
  for (const t of wrap(ctx, page.title, width)) {
    if (draw) ctx.fillText(t, TEX_W / 2, y);
    y += Math.round(size * 1.8);
  }
  if (draw) {
    ctx.strokeStyle = 'rgba(110, 72, 34, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TEX_W / 2 - 140, y - size * 0.9);
    ctx.lineTo(TEX_W / 2 + 140, y - size * 0.9);
    ctx.stroke();
  }
  y += Math.round(size * 0.4);
  ctx.textAlign = 'left';
  for (const b of page.blocks) {
    if ('h2' in b) {
      ctx.font = `700 ${Math.round(size * 1.15)}px ${VOICE}`;
      y += Math.round(size * 0.5);
      if (draw) ctx.fillText(b.h2, left, y);
      y += line;
    } else if ('p' in b || 'note' in b) {
      const text = 'p' in b ? b.p : b.note;
      ctx.font = `${BODY} ${Math.round(size * ('note' in b ? 0.9 : 1))}px ${VOICE}`;
      ctx.fillStyle = 'note' in b ? '#5a3a1c' : INK;
      for (const t of wrap(ctx, text, width)) {
        if (draw) ctx.fillText(t, left, y);
        y += line;
      }
      ctx.fillStyle = INK;
      y += Math.round(size * 0.35);
    } else if ('li' in b) {
      ctx.font = `${BODY} ${size}px ${VOICE}`;
      const indent = Math.round(size * 1.1);
      const lines = wrap(ctx, b.li, width - indent);
      lines.forEach((t, i) => {
        if (draw) {
          if (i === 0) {
            ctx.fillStyle = '#8a2f1d';
            ctx.beginPath();
            ctx.arc(left + size * 0.35, y - size * 0.35, size * 0.15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = INK;
          }
          ctx.fillText(t, left + indent, y);
        }
        y += line;
      });
      y += Math.round(size * 0.2);
    } else if ('rows' in b) {
      ctx.font = `${BODY} ${size}px ${VOICE}`;
      const half = Math.ceil(b.rows.length / 2);
      const col = width / 2;
      b.rows.forEach(([k, v], i) => {
        const x = left + (i < half ? 0 : col);
        const yy = y + (i % half) * line;
        if (draw) {
          ctx.fillStyle = INK;
          ctx.fillText(k, x + size * 0.4, yy);
          ctx.fillStyle = '#8a2f1d';
          ctx.textAlign = 'right';
          ctx.fillText(v, x + col - size * 0.8, yy);
          ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(110, 72, 34, 0.25)';
          ctx.fillRect(x + size * 0.4, yy + size * 0.3, col - size * 1.2, 1.5);
          ctx.fillStyle = INK;
        }
      });
      y += half * line + Math.round(size * 0.4);
    } else if ('big' in b) {
      ctx.font = `700 ${Math.round(size * 1.25)}px ${VOICE}`;
      ctx.fillStyle = '#8a2f1d';
      ctx.textAlign = 'center';
      y += Math.round(size * 0.8);
      for (const t of wrap(ctx, b.big, width)) {
        if (draw) ctx.fillText(t, TEX_W / 2, y);
        y += Math.round(size * 1.7);
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = INK;
    }
  }
  return y <= bottom;
}

function texture(canvas: HTMLCanvasElement, mirror: boolean): CanvasTexture {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  // As sharp as the screen allows when the page is seen at a slant (three clamps to the device's limit).
  t.anisotropy = 16;
  if (mirror) {
    // Seen from its back (a page that has been turned): the spine is on its right.
    t.wrapS = RepeatWrapping;
    t.repeat.x = -1;
    t.offset.x = 1;
  }
  return t;
}

/** Page `index` (reading order, see BOOK_PAGES) painted on paper; `mirror` for a face seen from the leaf's back. */
export function pageTexture(index: number, mirror: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(TEX_W * PAGE_SCALE);
  canvas.height = Math.round(TEX_H * PAGE_SCALE);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(PAGE_SCALE, PAGE_SCALE);
  const page = BOOK_PAGES[index];
  const endpaper = index === 0 || index === BOOK_PAGES.length - 1;
  paper(ctx, index + 1, endpaper);
  // The biggest type that fits.
  let size = 40;
  while (size > 24 && !layout(ctx, page, size, false)) size -= 2;
  layout(ctx, page, size, true);
  // The page number at the foot (the endpapers have none).
  if (!endpaper) {
    ctx.font = `600 30px ${VOICE}`;
    ctx.fillStyle = 'rgba(80, 52, 26, 0.8)';
    ctx.textAlign = 'center';
    ctx.fillText(`— ${index} —`, TEX_W / 2, TEX_H - 88);
  }
  return texture(canvas, mirror);
}

/** The leather of the covers: dark red-brown with grain; the front one tooled in gold with the title. */
export function coverTexture(front: boolean): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#4a1913';
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  let s = front ? 7 : 11;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 220, 190, 0.035)';
    ctx.fillRect(rnd() * TEX_W, rnd() * TEX_H, 2 + rnd() * 6, 1 + rnd() * 2);
  }
  const edge = ctx.createRadialGradient(TEX_W / 2, TEX_H / 2, TEX_H * 0.25, TEX_W / 2, TEX_H / 2, TEX_H * 0.8);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  if (front) {
    const gold = ctx.createLinearGradient(0, 0, TEX_W, TEX_H);
    gold.addColorStop(0, '#f3d27a');
    gold.addColorStop(0.5, '#c8963e');
    gold.addColorStop(1, '#f0cf78');
    ctx.strokeStyle = gold;
    ctx.lineWidth = 6;
    ctx.strokeRect(70, 70, TEX_W - 140, TEX_H - 140);
    ctx.lineWidth = 2;
    ctx.strokeRect(92, 92, TEX_W - 184, TEX_H - 184);
    ctx.fillStyle = gold;
    ctx.textAlign = 'center';
    ctx.font = `700 64px ${VOICE}`;
    ctx.fillText('이 게임이', TEX_W / 2, 400);
    ctx.fillText('매우 전략적인', TEX_W / 2, 490);
    ctx.fillText('이유', TEX_W / 2, 580);
    ctx.font = `200px ${VOICE}`;
    ctx.fillText('♞', TEX_W / 2, 900);
    ctx.font = `600 34px ${VOICE}`;
    ctx.fillText('VERY TACTICAL CHESS', TEX_W / 2, 1150);
  }
  return texture(canvas, false);
}
