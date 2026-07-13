export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;

// Every arena shares the same overall dimensions and spawn points (so the
// camera zoom-to-fit math and networking stay simple) but has its own
// platform layout and backdrop theme.
//
// IMPORTANT vertical-layout rule (why all arenas use the same tier tops
// 520 / 385 / 250 with 16px-thick floating platforms):
// The ground surface is at y=660. A player standing on any surface must be
// able to (a) walk UNDER the platform on the tier above without their body
// clipping it, and (b) still be able to JUMP up onto it. That means the
// vertical gap between one surface and the platform above must satisfy
// BOTH:
//   gap - thickness >= 108   (adult hitbox height — else tall players get
//                             wedged under the platform and can't move)
//   gap <= 156               (adult max jump height @ gravity 900 — else
//                             the platform is unreachable)
// A ~135px gap with 16px platforms hits the sweet spot (clearance ~119,
// reach margin ~21). Keep new/edited platforms on these tiers, or re-run
// the clearance check before shipping — an earlier layout put the lowest
// tier only ~80px above the ground and trapped Medium/Adult players.
export const SPAWN_POINTS = [
  { x: 100, y: 600 },
  { x: 1180, y: 600 },
  { x: 100, y: 260 },
  { x: 1180, y: 260 },
  { x: 640, y: 600 },
  { x: 640, y: 260 },
];

export const ARENAS = {
  warehouse: {
    key: 'warehouse',
    label: 'Warehouse',
    platforms: [
      { x: 0, y: 660, w: 1280, h: 60 }, // ground
      { x: 80, y: 520, w: 220, h: 16 },
      { x: 980, y: 520, w: 220, h: 16 },
      { x: 150, y: 385, w: 200, h: 16 },
      { x: 930, y: 385, w: 200, h: 16 },
      { x: 430, y: 385, w: 220, h: 16 },
      { x: 630, y: 250, w: 220, h: 16 },
    ],
    theme: {
      bands: [0x14151c, 0x191b24, 0x20222d, 0x272a38],
      skyline: 0x1e2029,
      platformTop: 0x3d4056,
      platformBody: 0x24252f,
    },
  },
  desert: {
    key: 'desert',
    label: 'Desert Base',
    platforms: [
      { x: 0, y: 660, w: 1280, h: 60 }, // sand
      { x: 120, y: 520, w: 260, h: 16 },
      { x: 900, y: 520, w: 260, h: 16 },
      { x: 480, y: 385, w: 320, h: 16 },
      { x: 60, y: 250, w: 160, h: 16 },
      { x: 1060, y: 250, w: 160, h: 16 },
    ],
    theme: {
      bands: [0x2a1c0d, 0x4a3218, 0x7a5326, 0xb8813f],
      skyline: 0x5c3f1f,
      platformTop: 0xd9b06b,
      platformBody: 0x6b4a26,
    },
  },
  neon: {
    key: 'neon',
    label: 'Neon City',
    platforms: [
      { x: 0, y: 660, w: 1280, h: 60 }, // street
      { x: 40, y: 520, w: 160, h: 16 },
      { x: 260, y: 520, w: 160, h: 16 },
      { x: 860, y: 520, w: 160, h: 16 },
      { x: 1080, y: 520, w: 160, h: 16 },
      { x: 150, y: 385, w: 200, h: 16 },
      { x: 930, y: 385, w: 200, h: 16 },
      { x: 540, y: 250, w: 200, h: 16 },
    ],
    theme: {
      bands: [0x0d0a1a, 0x180f30, 0x261346, 0x3d1a5c],
      skyline: 0x2a1450,
      platformTop: 0xff2ec4,
      platformBody: 0x1a1030,
    },
  },
};

export const ARENA_LIST = Object.values(ARENAS);
export const DEFAULT_ARENA = 'warehouse';

// Supply crates spawn at random spots on random platforms (host decides) and
// fall in. Their contents are unknown until a player attacks one open — it
// may or may not contain an item (health pack or one of the temporary
// boosts), which then auto-collects by walking near it (no button press),
// any size.
export const HEALTH_PICKUP_HEAL = 35;
export const HEALTH_PICKUP_RADIUS = 26;
export const CRATE_MIN_INTERVAL_MS = 8000;
export const CRATE_MAX_INTERVAL_MS = 15000;
export const CRATE_MAX_ACTIVE = 3;
export const CRATE_FALL_SPEED = 260;
export const CRATE_HP = 30;
export const CRATE_DROP_CHANCE = 0.5;
export const CRATE_HIT_RADIUS = 22;
export const DROP_ITEM_TTL_MS = 20000;
export const DROP_KINDS = ['heal', 'speed', 'damage', 'shield'];
export const BOOST_DURATION_MS = 8000;
export const SPEED_BOOST_MULTIPLIER = 1.5;
export const DAMAGE_BOOST_MULTIPLIER = 1.6;
export const SHIELD_DAMAGE_REDUCTION = 0.5;

export const PLAYER_COLORS = [0x6ee7ff, 0xff8a5c, 0xb98af7, 0x7ee787, 0xffe066, 0xff5c8a];

// Match ends when a player reaches this many kills. Host picks in the lobby.
export const KILL_TARGET_OPTIONS = [5, 10, 15, 20];
export const DEFAULT_KILL_TARGET = 10;
