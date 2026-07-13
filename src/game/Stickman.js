import { SIZES } from './sizes.js';
import { WEAPONS } from './weapons.js';
import { getWeaponParts } from './weaponShapes.js';

function toCss(num) {
  return '#' + num.toString(16).padStart(6, '0');
}

const HIT_FLASH_DURATION = 150;
const DEATH_COLLAPSE_DURATION = 450;
const HIT_FLASH_COLOR = 0xff5c5c;
const DASH_TRAIL_DURATION = 160; // matches GameScene's DASH_DURATION_MS

/**
 * Visual + physics representation of one stickman fighter.
 * Movement uses an invisible physics "zone" as the collision body; a
 * Graphics object is redrawn every frame to draw the actual stick figure
 * (this keeps physics simple while still letting us animate limbs/weapon).
 */
export class Stickman {
  constructor(scene, { x, y, color, sizeKey, name, isLocal }) {
    this.scene = scene;
    this.sizeDef = SIZES[sizeKey] || SIZES.medium;
    this.color = color;
    this.name = name;
    this.isLocal = isLocal;

    this.zone = scene.add.zone(x, y, this.sizeDef.hitboxWidth, this.sizeDef.hitboxHeight);
    scene.physics.add.existing(this.zone, false);
    this.zone.body.setCollideWorldBounds(true);
    this.zone.body.setSize(this.sizeDef.hitboxWidth, this.sizeDef.hitboxHeight);

    this.graphics = scene.add.graphics();
    this.nameText = scene.add.text(x, y, name, {
      fontSize: '12px',
      fontStyle: 'bold',
      color: isLocal ? '#6ee7ff' : toCss(color),
      fontFamily: 'system-ui, sans-serif',
      stroke: '#0a0b10',
      strokeThickness: 3,
    }).setOrigin(0.5, 1);

    this.hpBarBg = scene.add.rectangle(x, y, 40, 5, 0x0a0b10).setOrigin(0, 0.5).setStrokeStyle(1, 0x000000, 0.7);
    this.hpBarFill = scene.add.rectangle(x, y, 40, 5, 0x52d67a).setOrigin(0, 0.5);

    this.hp = this.sizeDef.maxHp;
    this.maxHp = this.sizeDef.maxHp;
    this.weapons = [];
    this.activeWeaponIndex = 0;
    this.facingAngle = 0;
    this.facingDir = 1;
    this.walkPhase = 0;
    this.idlePhase = Math.random() * Math.PI * 2;
    this.gaitBlend = 0; // 0 = idle stance, 1 = full walk cycle; eased for smooth transitions
    this.attackAnimTimer = 0;
    this.attackAnimDuration = 150;
    this.hitFlashTimer = 0;
    this.deathTimer = 0;
    this.dashTimer = 0;
    this.dashCooldownUntil = 0;
    this.dashVX = 0;
    this._alive = true;
    this.kills = 0;
    this.deaths = 0;
    this.lastAttackAt = {};
    this.speedBoostUntil = 0;
    this.speedBoostActive = false;
    this.damageBoostUntil = 0;
    this.damageBoostActive = false;
    this.shieldUntil = 0;
    this.shieldActive = false;
  }

  get x() { return this.zone.x; }
  get y() { return this.zone.y; }
  get body() { return this.zone.body; }
  get activeWeaponKey() { return this.weapons[this.activeWeaponIndex]; }

  get alive() { return this._alive; }
  set alive(value) {
    if (this._alive && !value) this.deathTimer = DEATH_COLLAPSE_DURATION;
    else if (!this._alive && value) {
      this.deathTimer = 0;
      this.hitFlashTimer = 0;
    }
    this._alive = value;
  }

  setPosition(x, y) {
    this.zone.setPosition(x, y);
  }

  triggerAttackAnim() {
    const weapon = WEAPONS[this.activeWeaponKey];
    this.attackAnimDuration = weapon?.type === 'melee' ? 180 : 90;
    this.attackAnimTimer = this.attackAnimDuration;
  }

  triggerHitFlash() {
    this.hitFlashTimer = HIT_FLASH_DURATION;
  }

  // Purely visual — used on clients to show a remote player's dash trail,
  // since the dash physics itself only runs on the host.
  showDash() {
    this.dashTimer = DASH_TRAIL_DURATION;
  }

  switchWeapon() {
    if (this.weapons.length > 1) {
      this.activeWeaponIndex = (this.activeWeaponIndex + 1) % this.weapons.length;
    }
  }

  // 2-bone inverse kinematics: draw a jointed limb from anchor (ax,ay) to
  // target (bx,by) with an upper segment of length l1 and lower of l2, the
  // joint (knee/elbow) bowing toward bendDir (+1 = the figure's facing side).
  // If the target is out of reach the limb points straight at it. This is
  // what gives the legs a real knee instead of a rigid stick.
  strokeLimb(g, ax, ay, bx, by, l1, l2, bendDir) {
    let dx = bx - ax;
    let dy = by - ay;
    let d = Math.hypot(dx, dy) || 0.0001;
    const maxD = l1 + l2 - 0.01;
    if (d > maxD) {
      const k = maxD / d;
      dx *= k;
      dy *= k;
      bx = ax + dx;
      by = ay + dy;
      d = maxD;
    }
    const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / d;
    const uy = dy / d;
    let px = -uy;
    let py = ux;
    if (px * bendDir < 0) { px = -px; py = -py; } // bow the joint toward facing
    const jx = ax + a * ux + h * px;
    const jy = ay + a * uy + h * py;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(jx, jy);
    g.lineTo(bx, by);
    g.strokePath();
  }

  updateVisual(dt) {
    // Based on actual horizontal position change rather than the physics
    // body's velocity, since remote players' bodies are disabled on
    // clients and only move via visual interpolation.
    const horizontalShift = Math.abs(this.x - (this._lastX ?? this.x));
    this._lastX = this.x;
    const moving = this.alive && horizontalShift > 0.3;
    this._isMoving = moving;
    // Ease a 0..1 gait blend toward moving/idle so the legs cross-fade
    // between the walk cycle and the idle stance instead of popping.
    const rate = Math.min(1, dt * 0.02);
    this.gaitBlend += ((moving ? 1 : 0) - this.gaitBlend) * rate;
    // Cadence is DISTANCE-driven, not time-driven: the phase advances by how
    // far the body actually moved (in stride-lengths), so the planted foot
    // stays anchored to the ground regardless of move speed, speed boosts,
    // or body size — no skating/moonwalk. The clamp guards against a big
    // one-frame jump (respawn/teleport) spinning the legs.
    const strideLen = 11 * this.sizeDef.scale;
    if (moving) {
      this.walkPhase += Math.min(horizontalShift, strideLen) / strideLen;
    } else if (this.gaitBlend > 0.05) {
      this.walkPhase += dt * 0.012; // finish the last step while fading out
    }
    this.idlePhase += dt * 0.0025;
    if (this.attackAnimTimer > 0) this.attackAnimTimer -= dt;
    if (this.hitFlashTimer > 0) this.hitFlashTimer -= dt;
    if (this.deathTimer > 0) this.deathTimer = Math.max(0, this.deathTimer - dt);
    if (this.dashTimer > 0) this.dashTimer = Math.max(0, this.dashTimer - dt);
    this.render();
  }

  render() {
    const g = this.graphics;
    g.clear();

    if (!this.alive) {
      this.nameText.setVisible(false);
      this.hpBarBg.setVisible(false);
      this.hpBarFill.setVisible(false);
      if (this.deathTimer > 0) this.renderDeathCollapse(g);
      return;
    }
    this.nameText.setVisible(true);
    this.hpBarBg.setVisible(true);
    this.hpBarFill.setVisible(true);

    const s = this.sizeDef.scale;
    const x = this.x;
    const y = this.y;
    const bottom = y + this.sizeDef.hitboxHeight / 2;
    const headR = 8 * s;
    const legLen = 22 * s;
    const torsoLen = 26 * s;
    const armLen = 18 * s;
    const thighLen = 13 * s;
    const shinLen = 14 * s;
    const baseHipY = bottom - legLen;

    const fwd = this.facingDir;
    const gb = this.gaitBlend; // 0 idle .. 1 walking

    // --- procedural body motion ---
    // Everything is expressed as offsets blended between an idle "breathing"
    // pose and a walk pose by `gb`, so idle<->walk cross-fades smoothly.
    //   bob     = whole-body vertical offset
    //   chest   = extra shoulder lift (NEGATIVE lengthens the torso = inhale)
    //   sway    = gentle horizontal weight-shift of the upper body (idle)
    //   headBob = small extra head motion so it isn't rigidly welded on
    const breath = Math.sin(this.idlePhase);
    const idleBob = -breath * 1.0 * s;
    const idleChest = -breath * 1.3 * s;
    const idleSway = Math.sin(this.idlePhase * 0.55) * 1.4 * s;
    const idleHeadBob = -breath * 0.5 * s;
    // Walk bounce: body rises at each mid-stance (legs passing together,
    // sin≈0 → cos≈±1) and dips when the legs are spread — twice per stride.
    const walkBob = -Math.abs(Math.cos(this.walkPhase)) * 2.6 * s;

    let bob;
    let chest;
    let sway;
    let headBob;
    if (this.dashTimer > 0) {
      bob = -1.5 * s; // slight lift into the dash
      chest = 0;
      sway = 0;
      headBob = 0;
    } else {
      bob = idleBob * (1 - gb) + walkBob * gb;
      chest = idleChest * (1 - gb); // chest expansion is an idle-only detail
      sway = idleSway * (1 - gb);
      headBob = idleHeadBob * (1 - gb);
    }

    const hipY = baseHipY + bob;
    const shoulderY = hipY - torsoLen + chest;
    const headY = shoulderY - headR + headBob;

    const auraBaseR = headR + torsoLen * 0.55;
    const auraCenterY = (hipY + shoulderY) / 2;
    const pulse = 0.55 + Math.sin(this.walkPhase * 3) * 0.2;
    if (this.speedBoostActive) {
      g.lineStyle(2, 0xffd23f, pulse);
      g.strokeCircle(x, auraCenterY, auraBaseR);
    }
    if (this.damageBoostActive) {
      g.lineStyle(2, 0xff5c5c, pulse);
      g.strokeCircle(x, auraCenterY, auraBaseR + 4);
    }
    if (this.shieldActive) {
      g.lineStyle(2, 0x6ee7ff, pulse);
      g.strokeCircle(x, auraCenterY, auraBaseR + 8);
    }

    // Dash afterimages: fading ghost copies of the whole figure trailing
    // behind, drawn before the real body so they read as motion streaks
    // left in its wake. Strength fades out over the dash duration.
    if (this.dashTimer > 0) {
      const trailStrength = this.dashTimer / DASH_TRAIL_DURATION;
      const dir = this.facingDir;
      for (let i = 3; i >= 1; i--) {
        const gx = x - dir * i * 12 * s;
        const a = trailStrength * (0.4 / i);
        g.lineStyle(3 * s, this.color, a);
        g.beginPath();
        // Splayed running pose for the ghosts: lead leg forward, trail
        // leg kicked back and up, torso leaning into the dash.
        g.moveTo(gx, hipY);
        g.lineTo(gx + dir * 12 * s, bottom);
        g.moveTo(gx, hipY);
        g.lineTo(gx - dir * 11 * s, bottom - 7 * s);
        g.moveTo(gx, hipY);
        g.lineTo(gx + dir * 6 * s, shoulderY);
        g.strokePath();
        g.fillStyle(this.color, a);
        g.fillCircle(gx + dir * 6 * s, shoulderY - headR, headR);
      }
    }

    // Briefly flash a hit color instead of the body's normal color right
    // after taking damage — a cheap but effective "ouch" reaction on top
    // of the existing physics knockback.
    const bodyColor = this.hitFlashTimer > 0 ? HIT_FLASH_COLOR : this.color;

    // Forward lean into the dash; idle adds a gentle weight-shift sway.
    const dashLean = this.dashTimer > 0 ? fwd * 6 * s : 0;
    const shoulderX = x + dashLean + sway;

    g.lineStyle(3 * s, bodyColor, 1);

    // --- legs: two jointed limbs (hip -> knee -> foot). Every horizontal
    // offset is multiplied by `fwd` (facing/movement direction) so the whole
    // gait mirrors cleanly left<->right — the earlier bug was the foot cycle
    // NOT being mirrored while the knee bend WAS, which made one direction
    // look distorted. Knees bow toward `fwd` via strokeLimb's bendDir. ---
    let footAx, footAy, footBx, footBy;
    if (this.dashTimer > 0) {
      // Mid-stride leap: lead leg reaching forward, trail leg kicked back+up.
      footAx = x + fwd * 14 * s; footAy = bottom;
      footBx = x - fwd * 13 * s; footBy = bottom - 9 * s;
    } else {
      // Blend idle stance <-> walk cycle by gaitBlend for smooth transitions.
      // Walk cycle (per leg, phase p):
      //   forward offset = sin(p)          — foot swings fore/aft
      //   lifted while    cos(p) > 0        — i.e. while it's moving FORWARD
      //   planted (on ground) while cos(p) <= 0 — sliding BACK to push off
      // That plant-slides-backward-relative-to-body is what actually drives
      // the figure forward (no moonwalk). Multiplied by fwd so it mirrors,
      // and the two legs run half a cycle (π) apart.
      const stride = 11 * s;
      const lift = 7 * s;
      const pA = this.walkPhase;
      const pB = this.walkPhase + Math.PI;
      const walkAx = x + fwd * Math.sin(pA) * stride;
      const walkAy = bottom - Math.max(0, Math.cos(pA)) * lift;
      const walkBx = x + fwd * Math.sin(pB) * stride;
      const walkBy = bottom - Math.max(0, Math.cos(pB)) * lift;
      // Idle: relaxed shoulder-width stance with a slight knee bend.
      const idleAx = x - 7 * s;
      const idleBx = x + 7 * s;
      footAx = idleAx + (walkAx - idleAx) * gb;
      footAy = bottom + (walkAy - bottom) * gb;
      footBx = idleBx + (walkBx - idleBx) * gb;
      footBy = bottom + (walkBy - bottom) * gb;
    }
    this.strokeLimb(g, x, hipY, footAx, footAy, thighLen, shinLen, fwd);
    this.strokeLimb(g, x, hipY, footBx, footBy, thighLen, shinLen, fwd);

    // Torso (hip -> leaned shoulder).
    g.beginPath();
    g.moveTo(x, hipY);
    g.lineTo(shoulderX, shoulderY);
    g.strokePath();

    g.fillStyle(bodyColor, 1);
    g.fillCircle(shoulderX, headY, headR);

    const weapon = WEAPONS[this.activeWeaponKey];
    let aimAngle = this.facingAngle;
    let recoil = 0;
    if (weapon && this.attackAnimTimer > 0) {
      const t = 1 - this.attackAnimTimer / this.attackAnimDuration;
      if (weapon.type === 'melee') {
        // Swing the whole arm+weapon through the weapon's strike arc, eased
        // out (fast wind-through, decelerating into full extension) rather
        // than a flat linear sweep — reads with more weight/impact.
        const arc = (weapon.arcDegrees * Math.PI) / 180;
        const linearT = Math.min(1, t * 1.3);
        const easedT = 1 - Math.pow(1 - linearT, 3);
        aimAngle = this.facingAngle - arc / 2 + arc * easedT;
      } else {
        // Kick the hand back along the aim line, then settle back out.
        recoil = Math.sin(Math.min(1, t * 2) * Math.PI) * 5 * s;
      }
    }

    const aimLen = armLen - recoil;
    const handX = shoulderX + Math.cos(aimAngle) * aimLen;
    const handY = shoulderY + Math.sin(aimAngle) * aimLen;
    g.lineStyle(3 * s, bodyColor, 1);
    g.beginPath();
    g.moveTo(shoulderX, shoulderY);
    g.lineTo(handX, handY);
    g.strokePath();

    // Off-arm rests slightly behind the facing direction and counter-swings
    // opposite the lead leg while walking. Forward offsets use `fwd` so it
    // mirrors cleanly, and the swing scales with gaitBlend for smooth idle
    // <-> walk. A tiny breathing bob keeps it alive when standing still.
    const armSwing = -fwd * Math.sin(this.walkPhase) * 7 * s * gb;
    const offHandX = x - fwd * 8 * s + armSwing;
    const offHandY = shoulderY + 12 * s + (this.dashTimer > 0 ? 0 : Math.sin(this.idlePhase) * 0.8 * s * (1 - gb));
    g.beginPath();
    g.moveTo(shoulderX, shoulderY);
    g.lineTo(offHandX, offHandY);
    g.strokePath();

    this.renderWeapon(g, weapon, handX, handY, aimAngle, s);

    this.nameText.setPosition(x, headY - headR - 16);
    const barX = x - 20;
    const barY = headY - headR - 6;
    this.hpBarBg.setPosition(barX, barY);
    this.hpBarFill.setPosition(barX, barY);
    const ratio = Math.max(0, this.hp / this.maxHp);
    this.hpBarFill.setSize(40 * ratio, 5);
    this.hpBarFill.fillColor = ratio > 0.5 ? 0x52d67a : ratio > 0.25 ? 0xd6c452 : 0xd65252;
  }

  // Simplified death animation: sinks and fades rather than a full ragdoll
  // tumble (the stick figure has no joints/physics to ragdoll with) — still
  // reads clearly as "down" instead of just instantly vanishing.
  renderDeathCollapse(g) {
    const t = 1 - this.deathTimer / DEATH_COLLAPSE_DURATION;
    const alpha = Math.max(0, 1 - t);
    const s = this.sizeDef.scale * (1 - t * 0.55);
    const x = this.x;
    const bottom = this.y + this.sizeDef.hitboxHeight / 2;
    const headR = 8 * s;
    const legLen = 22 * s;
    const torsoLen = 26 * s;
    const hipY = bottom - legLen;
    const shoulderY = hipY - torsoLen;
    const headY = shoulderY - headR;

    g.lineStyle(3 * s, this.color, alpha);
    g.beginPath();
    g.moveTo(x, hipY);
    g.lineTo(x - 8 * s, bottom);
    g.moveTo(x, hipY);
    g.lineTo(x + 8 * s, bottom);
    g.moveTo(x, hipY);
    g.lineTo(x, shoulderY);
    g.strokePath();

    g.fillStyle(this.color, alpha);
    g.fillCircle(x, headY, headR);
  }

  renderWeapon(g, weapon, handX, handY, angle, s) {
    if (!weapon) return;
    const parts = getWeaponParts(weapon.key, weapon.color);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    parts.forEach((part) => {
      const pts = part.points.map(([lx, ly]) => [
        handX + lx * s * cos - ly * s * sin,
        handY + lx * s * sin + ly * s * cos,
      ]);
      if (part.line) {
        g.lineStyle(1.5 * s, part.color, 0.8);
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        g.lineTo(pts[1][0], pts[1][1]);
        g.strokePath();
        return;
      }
      g.fillStyle(part.color, 1);
      g.beginPath();
      pts.forEach(([px, py], i) => (i === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
      g.closePath();
      g.fillPath();
    });
  }

  destroy() {
    this.zone.destroy();
    this.graphics.destroy();
    this.nameText.destroy();
    this.hpBarBg.destroy();
    this.hpBarFill.destroy();
  }
}
