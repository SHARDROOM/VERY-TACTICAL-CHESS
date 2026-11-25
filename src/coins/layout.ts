import { isHex, type Color } from '../engine';
import { HEX_FRAME_R } from '../scene/coords';

/** Where things sit, for a dealer standing on `side` (+1 = +x) of the table. */
export function coinLayout(side: 1 | -1) {
  if (isHex()) {
    // The hexagon: each dish just beyond the right-hand end of its player's back rank (the corner
    // there), the tally between it and the board, the dealer further out the same way.
    const dish = {} as Record<Color, [number, number]>;
    const tally = {} as Record<Color, [number, number]>;
    const dealer = {} as Record<Color, number>;
    for (const [color, corner] of [['white', 300], ['black', 60], ['red', 180]] as const) {
      const a = (corner * Math.PI) / 180;
      // The corner on the table (the board's plane has y toward black and red; the table's z is the other way).
      const [cx, cz] = [Math.cos(a), -Math.sin(a)];
      dish[color] = [cx * (HEX_FRAME_R + 1.3), cz * (HEX_FRAME_R + 1.3)];
      tally[color] = [cx * (HEX_FRAME_R + 0.2) + (color === 'red' ? 0 : 0.9), cz * (HEX_FRAME_R + 0.2)];
      dealer[color] = dish[color][0] + Math.sign(cx || 1) * 5;
    }
    return { dealerX: dealer, dish, tally };
  }
  const dishX = side * 6.9;
  // Kept toward the middle of the table so the default camera (and the side panel) leave them in view.
  const whiteZ = 1.5;
  const blackZ = -1.9;
  const redZ = -0.2;
  const tallyX = side * 5.3;
  const dealer = dishX + side * 5;
  return {
    dealerX: { white: dealer, black: dealer, red: dealer } as Record<Color, number>,
    dish: { white: [dishX, whiteZ], black: [dishX, blackZ], red: [dishX, redZ] } as Record<Color, [number, number]>,
    /** Tally marks carved between the board and each dish. */
    tally: { white: [tallyX, whiteZ], black: [tallyX, blackZ], red: [tallyX, redZ] } as Record<Color, [number, number]>,
  };
}
