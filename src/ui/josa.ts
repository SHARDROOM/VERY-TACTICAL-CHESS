// Korean particle selection: picks 이/가, 을/를, 은/는, 와/과, (으)로 by the last syllable.

/** Final-consonant code of the last character's reading (0 = none, 8 = ㄹ), including digits as read in Sino-Korean. */
function finalConsonant(word: string): number {
  const last = word.trim().slice(-1);
  const digit = '0123456789'.indexOf(last);
  // 영(ㅇ) 일(ㄹ) 이 삼(ㅁ) 사 오 육(ㄱ) 칠(ㄹ) 팔(ㄹ) 구
  if (digit >= 0) return [21, 8, 0, 16, 0, 0, 1, 8, 8, 0][digit];
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return 0;
  return code % 28;
}

type Pair = '이/가' | '을/를' | '은/는' | '와/과' | '으로/로';

/** Word followed by the right particle, e.g. josa('나이트', '을/를') → '나이트를'. */
export function josa(word: string, pair: Pair): string {
  const fc = finalConsonant(word);
  if (pair === '으로/로') return word + (fc === 0 || fc === 8 ? '로' : '으로');
  // 와 follows a vowel, 과 a consonant (the pair is written the other way round from 이/가).
  if (pair === '와/과') return word + (fc === 0 ? '와' : '과');
  const [withBatchim, without] = pair.split('/');
  return word + (fc === 0 ? without : withBatchim);
}
