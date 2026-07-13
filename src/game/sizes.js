// Stickman body sizes. `scale` drives rendering, hitbox and stats.
export const SIZES = {
  child: {
    key: 'child',
    label: 'Child',
    scale: 0.72,
    moveSpeed: 250,
    jumpVelocity: -610,
    maxHp: 70,
    hitboxWidth: 22,
    hitboxHeight: 62,
  },
  medium: {
    key: 'medium',
    label: 'Medium',
    scale: 1.0,
    moveSpeed: 210,
    jumpVelocity: -565,
    maxHp: 100,
    hitboxWidth: 28,
    hitboxHeight: 84,
  },
  adult: {
    key: 'adult',
    label: 'Adult',
    scale: 1.3,
    moveSpeed: 180,
    jumpVelocity: -530,
    maxHp: 135,
    hitboxWidth: 34,
    hitboxHeight: 108,
  },
};

export const SIZE_LIST = Object.values(SIZES);
export const DEFAULT_SIZE = 'medium';
