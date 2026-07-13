import { WEAPONS } from './weapons.js';
import { getWeaponParts } from './weaponShapes.js';

export function hexToCss(num) {
  return '#' + num.toString(16).padStart(6, '0');
}

/**
 * Draws a static idle-pose stick figure on a plain 2D canvas context.
 * Used for UI previews (character setup + lobby list) — the actual
 * in-match rendering lives in Stickman.js and uses Phaser's Graphics API.
 */
export function drawStickFigure(ctx, { width, height, sizeScale, colorCss, weaponKeys = [] }) {
  ctx.clearRect(0, 0, width, height);

  const s = sizeScale;
  const cx = width / 2;
  const feetY = height - 14;
  const legLen = 22 * s;
  const torsoLen = 26 * s;
  const armLen = 18 * s;
  const headR = 8 * s;

  const hipY = feetY - legLen;
  const shoulderY = hipY - torsoLen;
  const headY = shoulderY - headR;

  ctx.lineCap = 'round';
  ctx.strokeStyle = colorCss;
  ctx.lineWidth = Math.max(2, 3 * s);

  ctx.beginPath();
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx - 10 * s, feetY);
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx + 10 * s, feetY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, hipY);
  ctx.lineTo(cx, shoulderY);
  ctx.stroke();

  ctx.fillStyle = colorCss;
  ctx.beginPath();
  ctx.arc(cx, headY, headR, 0, Math.PI * 2);
  ctx.fill();

  drawArmAndWeapon(ctx, { shoulderX: cx, shoulderY, dirX: 1, s, armLen, colorCss, weaponKey: weaponKeys[0] });
  drawArmAndWeapon(ctx, { shoulderX: cx, shoulderY, dirX: -1, s, armLen, colorCss, weaponKey: weaponKeys[1] });
}

function drawArmAndWeapon(ctx, { shoulderX, shoulderY, dirX, s, armLen, colorCss, weaponKey }) {
  const handX = shoulderX + dirX * armLen * 0.9;
  const handY = shoulderY + armLen * 0.5;
  const angle = Math.atan2(handY - shoulderY, handX - shoulderX);

  ctx.strokeStyle = colorCss;
  ctx.lineWidth = Math.max(2, 3 * s);
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  const weapon = WEAPONS[weaponKey];
  if (!weapon) return;
  drawWeaponParts(ctx, weapon, handX, handY, angle, s);
}

function drawWeaponParts(ctx, weapon, handX, handY, angle, s) {
  const parts = getWeaponParts(weapon.key, weapon.color);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  parts.forEach((part) => {
    const pts = part.points.map(([lx, ly]) => [
      handX + lx * s * cos - ly * s * sin,
      handY + lx * s * sin + ly * s * cos,
    ]);
    if (part.line) {
      ctx.strokeStyle = hexToCss(part.color);
      ctx.lineWidth = Math.max(1, 1.5 * s);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      ctx.lineTo(pts[1][0], pts[1][1]);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = hexToCss(part.color);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fill();
  });
}
