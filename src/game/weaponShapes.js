// Local-space silhouette geometry for weapons, shared by the in-game Phaser
// renderer (Stickman.js) and the canvas2D avatar preview (drawStickFigure.js).
//
// Coordinate convention: x runs forward along the aim direction (0 = the
// hand/grip point), y is the perpendicular offset (negative = "up" before
// rotation). Callers rotate+translate these points by the aim angle and the
// hand position, then fill each part as a polygon in listed (back-to-front)
// paint order.

const STEEL = 0x4a4d57;
const DARK_STEEL = 0x24252b;
const POLYMER = 0x1c1d22;
const WOOD = 0x8a5a2b;
const SILVER = 0xc7c9cf;

function rect(x0, x1, y0, y1, color) {
  return { points: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], color };
}

function poly(points, color) {
  return { points, color };
}

const BUILDERS = {
  // ---- Melee ----
  sword: (c) => [
    rect(-6, 8, -3, 3, DARK_STEEL), // grip
    rect(6, 10, -7, 7, SILVER), // crossguard
    poly([[10, -2.5], [46, -1.2], [56, 0], [46, 1.2], [10, 2.5]], c), // tapered blade
  ],
  dagger: (c) => [
    rect(-4, 5, -2.5, 2.5, DARK_STEEL),
    rect(5, 7, -4, 4, SILVER),
    poly([[7, -2], [28, -1], [36, 0], [28, 1], [7, 2]], c),
  ],
  axe: (c) => [
    rect(-8, 40, -1.8, 1.8, WOOD), // haft
    poly([[30, -3], [40, -14], [54, -16], [58, -4], [46, 4], [40, 3]], STEEL), // head
    poly([[36, -3], [40, -13], [46, -11], [42, -1]], c), // edge highlight
  ],
  spear: (c) => [
    rect(-10, 62, -1.4, 1.4, WOOD),
    poly([[62, -4], [78, -1.5], [86, 0], [78, 1.5], [62, 4]], SILVER),
    poly([[62, -2], [74, -0.6], [80, 0]], c),
  ],
  bat: (c) => [
    rect(-8, 8, -2.2, 2.2, c), // taped grip
    poly([[8, -2.6], [34, -3.4], [46, -6], [50, 0], [46, 6], [34, 3.4], [8, 2.6]], WOOD),
  ],
  katana: (c) => [
    rect(-7, 7, -2, 2, DARK_STEEL), // wrapped grip
    rect(7, 10, -6, 6, SILVER), // small guard
    poly([[10, -2], [34, -2.6], [50, -1.6], [58, 0], [50, 1], [34, 1], [10, 1.6]], c), // curved single edge
  ],
  hammer: (c) => [
    rect(-12, 34, -1.8, 1.8, WOOD), // haft
    rect(30, 50, -9, -6, SILVER), // head top highlight
    rect(30, 50, -6, 9, c), // heavy square head
  ],

  // ---- Bows ----
  bow: (c) => [
    rect(-2, 3, -2.6, 2.6, WOOD),
    poly([[0, -3], [10, -12], [14, -22], [8, -27], [-2, -22], [-2, -3]], c), // upper limb
    poly([[0, 3], [10, 12], [14, 22], [8, 27], [-2, 22], [-2, 3]], c), // lower limb
    { points: [[8, -27], [8, 27]], color: 0xe8e6df, line: true },
  ],
  crossbow: (c) => [
    rect(-14, 16, -2.4, 2.4, DARK_STEEL), // stock/body
    poly([[6, -2], [16, -10], [22, -16], [17, -19], [8, -12], [4, -2]], c), // upper limb
    poly([[6, 2], [16, 10], [22, 16], [17, 19], [8, 12], [4, 2]], c), // lower limb
    { points: [[17, -19], [17, 19]], color: 0xe8e6df, line: true },
    rect(16, 24, -1, 1, STEEL), // barrel groove
  ],

  // ---- Pistols ----
  pistol: (c) => [
    poly([[-6, 2], [-4, 12], [0, 13], [1, 2]], POLYMER), // grip
    rect(-2, 20, -3.2, 3.2, c), // slide
    rect(20, 26, -1.6, 1.6, DARK_STEEL), // barrel/muzzle
    rect(2, 8, 3.2, 6, DARK_STEEL), // trigger guard hint
  ],
  throwingKnife: (c) => [
    rect(-3, 3, -1.6, 1.6, DARK_STEEL), // small grip wrap
    poly([[3, -2.2], [14, -0.8], [18, 0], [14, 0.8], [3, 2.2]], c), // small blade
  ],

  // ---- Shotguns ----
  shotgun: (c) => [
    rect(-16, -6, -4, 5, WOOD), // stock
    rect(-6, 2, -3.4, 3.4, DARK_STEEL), // receiver
    rect(0, 16, -2.4, 2.4, POLYMER), // pump/foreend
    rect(14, 50, -1.6, 1.6, STEEL), // long barrel
    rect(46, 51, -2.4, 2.4, c), // muzzle band accent
  ],

  // ---- Rifles / carbines ----
  rifle: (c) => [
    rect(-18, 0, -3, 3, POLYMER), // stock
    poly([[-2, 2], [4, 12], [8, 13], [6, 2]], POLYMER), // pistol grip
    rect(4, 16, 2, 15, DARK_STEEL), // curved magazine
    rect(0, 30, -4, 4, c), // upper receiver / handguard
    rect(2, 5, -6.5, -4, DARK_STEEL), // rear sight
    rect(30, 46, -1.6, 1.6, STEEL), // barrel
    rect(41, 43, -5, -3.6, DARK_STEEL), // front sight
    rect(44, 48, -2.4, 2.4, DARK_STEEL), // flash hider
  ],
  smg: (c) => [
    rect(-11, 0, -2.6, 2.6, POLYMER), // folding stock
    poly([[-1, 2], [3, 10], [6, 11], [5, 2]], POLYMER), // grip
    rect(3, 8, 2, 13, DARK_STEEL), // curved mag
    rect(0, 20, -3.6, 3.6, c), // body
    rect(20, 27, -1.3, 1.3, STEEL), // short barrel
  ],
  sniper: (c) => [
    rect(-22, -2, -3.2, 4.2, WOOD), // stock with cheek riser
    poly([[-2, 2], [2, 11], [5, 12], [4, 2]], DARK_STEEL), // grip
    rect(4, 9, 2, 11, DARK_STEEL), // magazine
    rect(-2, 18, -3.6, 3.6, c), // receiver
    rect(2, 18, -8.5, -5.5, DARK_STEEL), // scope body
    rect(4, 6, -9.5, -8, STEEL), // scope objective ring
    rect(18, 58, -1.4, 1.4, STEEL), // long barrel
    rect(53, 58, -2, 2, DARK_STEEL), // muzzle brake
  ],
  lmg: (c) => [
    rect(-16, -1, -4.2, 4.2, POLYMER), // stock
    poly([[-1, 3], [3, 12], [7, 13], [5, 3]], POLYMER), // grip
    rect(2, 18, -5, 5, c), // bulky receiver
    poly([[5, 5], [16, 5], [16, 15], [12, 17], [5, 15]], DARK_STEEL), // drum magazine
    rect(18, 46, -2.2, 2.2, STEEL), // heavy barrel
    poly([[40, 2], [46, 10], [43, 11], [38, 3]], DARK_STEEL), // folded bipod leg
    poly([[40, -2], [46, -10], [43, -11], [38, -3]], DARK_STEEL), // folded bipod leg
  ],
  rpg: (c) => [
    poly([[-2, -3], [-11, -8], [-11, 8], [-2, 3]], DARK_STEEL), // rear fin/stabilizer
    rect(-16, 4, -3, 3, POLYMER), // grip/trigger housing
    rect(0, 44, -4.6, 4.6, DARK_STEEL), // launcher tube
    rect(8, 14, -8, -4.8, DARK_STEEL), // sight
    poly([[44, -6.5], [60, 0], [44, 6.5]], c), // warhead nose cone
  ],
  grenade: (c) => [
    poly([[-6, -3], [0, -6], [6, -3], [6, 3], [0, 6], [-6, 3]], c), // rounded body
    rect(-1, 1, -9, -6, DARK_STEEL), // pin stem
    poly([[1, -9], [7, -9], [7, -6], [1, -6]], SILVER), // safety lever
  ],
  heavyGrenade: (c) => [
    poly([[-8, -4], [0, -8], [8, -4], [8, 4], [0, 8], [-8, 4]], c), // bigger, heavier body
    rect(-6, 6, -2, 2, DARK_STEEL), // ridge band
    rect(-1, 1, -11, -8, DARK_STEEL), // pin stem
    poly([[1, -11], [8, -11], [8, -8], [1, -8]], SILVER), // safety lever
  ],
  stunGrenade: (c) => [
    rect(-4, 4, -7, 7, c), // slim canister body
    rect(-4, 4, -1, 1, DARK_STEEL), // center band
    rect(-1, 1, -10, -7, DARK_STEEL), // pin stem
    poly([[1, -10], [6, -10], [6, -7], [1, -7]], SILVER), // safety lever
  ],
};

const DEFAULT_BUILDER = (c) => [rect(0, 30, -1.6, 1.6, c)];

export function getWeaponParts(weaponKey, accentColor) {
  const build = BUILDERS[weaponKey] || DEFAULT_BUILDER;
  return build(accentColor);
}
