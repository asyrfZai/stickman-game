import Phaser from 'phaser';
import { Stickman } from './Stickman.js';
import { WEAPONS } from './weapons.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  ARENAS,
  DEFAULT_ARENA,
  SPAWN_POINTS,
  PLAYER_COLORS,
  HEALTH_PICKUP_HEAL,
  HEALTH_PICKUP_RADIUS,
  CRATE_MIN_INTERVAL_MS,
  CRATE_MAX_INTERVAL_MS,
  CRATE_MAX_ACTIVE,
  CRATE_FALL_SPEED,
  CRATE_HP,
  CRATE_DROP_CHANCE,
  CRATE_HIT_RADIUS,
  DROP_ITEM_TTL_MS,
  DROP_KINDS,
  BOOST_DURATION_MS,
  SPEED_BOOST_MULTIPLIER,
  DAMAGE_BOOST_MULTIPLIER,
  SHIELD_DAMAGE_REDUCTION,
} from './arena.js';

const STATE_BROADCAST_MS = 70; // ~14Hz — lower to ease host upload load as player count grows
const INPUT_SEND_MS = 40; // ~25Hz
const RESPAWN_DELAY_MS = 2500;
const PROJECTILE_GRAVITY = 900;
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 540;
const RPG_EXPLOSION_RADIUS = 90;
const GRENADE_KEYS = ['grenade', 'heavyGrenade', 'stunGrenade'];
const EXPLOSION_FX_DURATION_MS = 400;
const DASH_SPEED_MULTIPLIER = 2.6;
const DASH_DURATION_MS = 160;
const DASH_COOLDOWN_MS = 900;

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
  }

  init(data) {
    this.network = data.network;
    this.isHost = data.isHost;
    this.myId = data.myId;
    this.playerConfigs = data.players; // [{id,name,size,weapons}]
    this.onHostLeft = data.onHostLeft || (() => {});
    this.onWeaponHud = data.onWeaponHud || (() => {});
    this.onLocalHud = data.onLocalHud || (() => {});
    this.onHitMarker = data.onHitMarker || (() => {});
    this.onKillFeed = data.onKillFeed || (() => {});
    this.onKillConfirm = data.onKillConfirm || (() => {});
    this.onMatchTimer = data.onMatchTimer || (() => {});
    this.onMatchEnd = data.onMatchEnd || (() => {});
    this.arenaDef = ARENAS[data.arenaKey] || ARENAS[DEFAULT_ARENA];
    this.killTarget = data.killTarget || 10;
    this.matchOver = false;
  }

  create() {
    // On mobile, aiming is handled by the dedicated drag pad (see
    // setupAimPad) instead of hovering/dragging the canvas — tapping the
    // canvas must NOT move the aim point or fire; firing has its own button.
    this.isMobileControls = document.documentElement.classList.contains('is-mobile');

    this.cameras.main.setBackgroundColor('#1b1c24');
    this.physics.world.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);

    // The arena is bigger than the fixed 960x540 canvas; zoom the camera out
    // so the whole map (and every player) stays visible at once rather than
    // scrolling/following one player, which keeps the multi-player HUD
    // simple. Mobile pulls back a bit further still — on a small physical
    // screen the same fit-zoom reads as visually "closer" than on desktop,
    // so this trades a bit of extra void margin around the arena for more
    // comfortable battlefield awareness.
    const baseZoom = VIEW_WIDTH / ARENA_WIDTH;
    const zoom = this.isMobileControls ? baseZoom * 0.88 : baseZoom;
    this.cameras.main.setZoom(zoom);
    this.cameras.main.centerOn(ARENA_WIDTH / 2, ARENA_HEIGHT / 2);

    this.drawBackdrop();

    this.platformsGroup = this.physics.add.staticGroup();
    const platGraphics = this.add.graphics();
    const { platformBody, platformTop } = this.arenaDef.theme;
    this.arenaDef.platforms.forEach((p) => {
      platGraphics.fillStyle(platformBody, 1);
      platGraphics.fillRect(p.x, p.y + 4, p.w, p.h - 4);
      platGraphics.fillStyle(platformTop, 1);
      platGraphics.fillRect(p.x, p.y, p.w, 4); // lit top edge
      const rect = this.add.rectangle(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h);
      rect.setVisible(false);
      this.physics.add.existing(rect, true);
      this.platformsGroup.add(rect);
    });

    this.crates = [];
    this.drops = [];
    this.crateSpawnTimer = 0;
    this.crateSpawnDelay = Phaser.Math.Between(CRATE_MIN_INTERVAL_MS, CRATE_MAX_INTERVAL_MS);
    this.pickupGraphics = this.add.graphics();

    this.explosionFx = [];
    this.explosionGraphics = this.add.graphics();

    this.stickmen = new Map();
    this.playerConfigs.forEach((cfg, i) => {
      const sp = SPAWN_POINTS[i % SPAWN_POINTS.length];
      const sm = new Stickman(this, {
        x: sp.x,
        y: sp.y,
        color: PLAYER_COLORS[i % PLAYER_COLORS.length],
        sizeKey: cfg.size,
        name: cfg.name,
        isLocal: cfg.id === this.myId,
      });
      sm.weapons = cfg.weapons.length ? cfg.weapons : ['sword'];
      sm.spawnPoint = sp;
      this.stickmen.set(cfg.id, sm);
      this.physics.add.collider(sm.zone, this.platformsGroup);

      // Clients only simulate physics locally for their own avatar (for
      // responsive controls). Remote avatars are pure visual interpolation
      // driven by host snapshots, so their bodies don't need to move.
      if (!this.isHost && cfg.id !== this.myId) {
        sm.body.enable = false;
      }
    });

    this.projectiles = [];
    this.projectileGraphics = this.add.graphics();
    this.crosshairGraphics = this.add.graphics().setDepth(1000);
    this.pendingEvents = [];
    this.matchStartTime = this.time.now;

    this.localInput = { left: false, right: false, jump: false, attack: false, mouseX: ARENA_WIDTH / 2, mouseY: ARENA_HEIGHT / 2 };
    this.remoteInputs = new Map();
    this._requestSwitch = false;
    this._requestDash = false;

    this.keys = this.input.keyboard.addKeys({ left: 'A', right: 'D', jump: 'W' });
    this.input.on('pointermove', (p) => {
      if (this.isMobileControls) return;
      // worldX/Y (not x/y) since the camera is zoomed out to fit the whole
      // arena — screen pixels no longer map 1:1 to world coordinates.
      this.localInput.mouseX = p.worldX;
      this.localInput.mouseY = p.worldY;
    });
    this.input.on('pointerdown', (p) => {
      if (!this.isMobileControls && p.leftButtonDown()) this.localInput.attack = true;
    });
    this.input.on('pointerup', () => {
      if (!this.isMobileControls) this.localInput.attack = false;
    });
    this.input.keyboard.on('keydown-Q', () => {
      this._requestSwitch = true;
    });
    this.input.keyboard.on('keydown-SPACE', () => {
      this._requestDash = true;
    });

    if (this.isMobileControls) this.setupTouchControls();

    const offData = this.network.on('data', (fromId, msg) => this.handleNetworkMessage(fromId, msg));
    const offDisc = this.network.on('client-disconnected', (id) => this.handlePlayerLeft(id));
    const offHostDisc = this.network.on('host-disconnected', () => this.onHostLeft());
    this.events.once('shutdown', () => {
      offData();
      offDisc();
      offHostDisc();
      this._touchCleanup?.forEach((fn) => fn());
    });

    this.broadcastTimer = 0;
    this.inputSendTimer = 0;
    this.scoreboardTimer = 0;
    this.scoreboardEl = document.getElementById('scoreboard');
  }

  handleNetworkMessage(fromId, msg) {
    if (msg.type === 'input' && this.isHost) {
      this.remoteInputs.set(fromId, msg.payload);
    } else if (msg.type === 'state' && !this.isHost) {
      this.applyState(msg.payload);
    } else if (msg.type === 'matchEnd' && !this.isHost) {
      this.matchOver = true;
      this.onMatchEnd(msg.payload);
    }
  }

  handlePlayerLeft(id) {
    this.remoteInputs.delete(id);
  }

  captureInput() {
    this.localInput.left = this.keys.left.isDown || this._touchLeft;
    this.localInput.right = this.keys.right.isDown || this._touchRight;
    this.localInput.jump = this.keys.jump.isDown || this._touchJump;
  }

  setupTouchControls() {
    this._touchLeft = false;
    this._touchRight = false;
    this._touchJump = false;
    this._touchCleanup = [];

    const bind = (id, onStart, onEnd) => {
      const el = document.getElementById(id);
      if (!el) return;
      const start = (e) => {
        e.preventDefault();
        onStart();
      };
      const end = (e) => {
        e.preventDefault();
        onEnd?.();
      };
      el.addEventListener('touchstart', start, { passive: false });
      el.addEventListener('touchend', end, { passive: false });
      el.addEventListener('touchcancel', end, { passive: false });
      this._touchCleanup.push(() => {
        el.removeEventListener('touchstart', start);
        el.removeEventListener('touchend', end);
        el.removeEventListener('touchcancel', end);
      });
    };

    const vibrate = (ms) => {
      try {
        navigator.vibrate?.(ms);
      } catch {
        // Unsupported on this device — purely cosmetic, safe to ignore.
      }
    };

    bind('btnTouchLeft', () => (this._touchLeft = true), () => (this._touchLeft = false));
    bind('btnTouchRight', () => (this._touchRight = true), () => (this._touchRight = false));
    bind('btnTouchJump', () => {
      this._touchJump = true;
      vibrate(8);
    }, () => (this._touchJump = false));
    bind('btnTouchFire', () => {
      this.localInput.attack = true;
      vibrate(12);
    }, () => (this.localInput.attack = false));
    bind('btnTouchSwitch', () => {
      this._requestSwitch = true;
      vibrate(8);
    });
    bind('btnTouchDash', () => {
      this._requestDash = true;
      vibrate(14);
    });

    this.setupAimPad();
  }

  // Drag-to-aim target pad: the knob's drag direction becomes a virtual aim
  // point far out from the player in that direction (not the knob's literal
  // screen position), so it works as a relative joystick regardless of
  // where the player currently is in the arena — same aiming inputs
  // (localInput.mouseX/Y) the desktop mouse path already feeds.
  setupAimPad() {
    const pad = document.getElementById('aimPad');
    const knob = document.getElementById('aimKnob');
    if (!pad || !knob) return;

    const KNOB_TRAVEL = 32;
    const AIM_REACH = 300;
    let activeTouchId = null;

    const applyKnob = (dx, dy) => {
      const dist = Math.min(KNOB_TRAVEL, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      knob.style.transform = `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px)`;
      const localSm = this.stickmen.get(this.myId);
      if (localSm) {
        this.localInput.mouseX = localSm.x + Math.cos(angle) * AIM_REACH;
        this.localInput.mouseY = localSm.y + Math.sin(angle) * AIM_REACH;
      }
    };

    const offsetFromCenter = (touch) => {
      const rect = pad.getBoundingClientRect();
      return [touch.clientX - (rect.left + rect.width / 2), touch.clientY - (rect.top + rect.height / 2)];
    };

    const start = (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      activeTouchId = touch.identifier;
      knob.classList.add('active');
      pad.classList.add('dragging');
      applyKnob(...offsetFromCenter(touch));
    };
    const move = (e) => {
      if (activeTouchId === null) return;
      const touch = [...e.touches].find((t) => t.identifier === activeTouchId);
      if (!touch) return;
      e.preventDefault();
      applyKnob(...offsetFromCenter(touch));
    };
    const end = (e) => {
      const touch = [...e.changedTouches].find((t) => t.identifier === activeTouchId);
      if (!touch) return;
      e.preventDefault();
      activeTouchId = null;
      knob.classList.remove('active');
      pad.classList.remove('dragging');
      knob.style.transform = 'translate(0px, 0px)';
      // Deliberately leave localInput.mouseX/Y at the last aim direction —
      // releasing the pad shouldn't snap the character's facing back to
      // whatever the default/last-used desktop position was.
    };

    // touchmove/touchend listen on window, not just the pad, since a drag
    // naturally moves the finger outside the pad's small bounding box —
    // the activeTouchId filter ignores unrelated touches (movement/fire
    // buttons etc.) so this doesn't interfere with them.
    pad.addEventListener('touchstart', start, { passive: false });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end, { passive: false });
    window.addEventListener('touchcancel', end, { passive: false });
    this._touchCleanup.push(() => {
      pad.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    });
  }

  update(time, delta) {
    // Once the match is decided, freeze the simulation/input but keep
    // rendering the final frame underneath the results overlay.
    if (this.matchOver) {
      this.stickmen.forEach((sm) => sm.updateVisual(delta));
      this.drawProjectiles();
      this.drawCrates();
      this.drawExplosions();
      return;
    }

    this.captureInput();

    if (this.isHost) this.hostUpdate(time, delta);
    else this.clientUpdate(time, delta);

    this.stickmen.forEach((sm) => sm.updateVisual(delta));
    this.drawProjectiles();
    this.drawCrates();
    this.drawExplosions();
    this.drawCrosshair();
    this.updateWeaponHud(time);

    this.scoreboardTimer += delta;
    if (this.scoreboardTimer > 250) {
      this.scoreboardTimer = 0;
      this.updateScoreboardDOM();
      this.updateLocalHud();
      this.onMatchTimer(this.time.now - this.matchStartTime);
    }
  }

  drawBackdrop() {
    const g = this.add.graphics();
    const { bands: bandColors, skyline } = this.arenaDef.theme;
    const stops = [0, 0.32, 0.66, 1];
    for (let i = 0; i < bandColors.length - 1; i++) {
      const y0 = stops[i] * ARENA_HEIGHT;
      const y1 = stops[i + 1] * ARENA_HEIGHT;
      g.fillStyle(bandColors[i], 1);
      g.fillRect(0, y0, ARENA_WIDTH, y1 - y0);
    }
    // Faint distant "skyline" silhouettes for depth.
    g.fillStyle(skyline, 0.8);
    for (let i = 0; i < 9; i++) {
      const bw = 60 + (i % 3) * 30;
      const bh = 90 + ((i * 37) % 140);
      g.fillRect((i * 150 + 20) % ARENA_WIDTH, ARENA_HEIGHT * 0.66 - bh, bw, bh);
    }
  }

  drawCrates() {
    const g = this.pickupGraphics;
    g.clear();
    // Plain box, no glow/cross hint — contents are unknown until attacked.
    this.crates.forEach((c) => {
      g.fillStyle(0x5a3d24, 1);
      g.fillRect(c.x - 12, c.y - 12, 24, 24);
      g.lineStyle(2, 0x3a2716, 1);
      g.strokeRect(c.x - 12, c.y - 12, 24, 24);
      g.beginPath();
      g.moveTo(c.x - 12, c.y - 12);
      g.lineTo(c.x + 12, c.y + 12);
      g.moveTo(c.x + 12, c.y - 12);
      g.lineTo(c.x - 12, c.y + 12);
      g.strokePath();
    });
    this.drawDrops();
  }

  drawDrops() {
    const g = this.pickupGraphics;
    const time = this.time.now;
    this.drops.forEach((drop) => {
      const bob = Math.sin(time * 0.004 + drop.x * 0.01) * 3;
      const y = drop.y + bob;
      const fading = drop.ttl < 3000;
      const alpha = fading ? 0.4 + 0.6 * Math.abs(Math.sin(time * 0.01)) : 1;
      const accentByKind = { heal: 0x52d67a, speed: 0xffd23f, damage: 0xff5c5c, shield: 0x6ee7ff };
      const accent = accentByKind[drop.kind] || 0x52d67a;
      g.fillStyle(0x1c1d22, 0.9 * alpha);
      g.fillCircle(drop.x, y, 13);
      g.lineStyle(2, accent, alpha);
      g.strokeCircle(drop.x, y, 13);
      g.fillStyle(accent, alpha);
      if (drop.kind === 'speed') {
        // Lightning bolt.
        const pts = [[2, -8], [-3, 0], [1, 0], [-2, 8], [3, 0], [-1, 0]];
        g.beginPath();
        pts.forEach(([lx, ly], i) => (i === 0 ? g.moveTo(drop.x + lx, y + ly) : g.lineTo(drop.x + lx, y + ly)));
        g.closePath();
        g.fillPath();
      } else if (drop.kind === 'damage') {
        // Crossed blades.
        g.lineStyle(2.5, accent, alpha);
        g.beginPath();
        g.moveTo(drop.x - 6, y - 6);
        g.lineTo(drop.x + 6, y + 6);
        g.moveTo(drop.x + 6, y - 6);
        g.lineTo(drop.x - 6, y + 6);
        g.strokePath();
      } else if (drop.kind === 'shield') {
        // Shield outline.
        const pts = [[0, -8], [6, -4], [6, 3], [0, 8], [-6, 3], [-6, -4]];
        g.beginPath();
        pts.forEach(([lx, ly], i) => (i === 0 ? g.moveTo(drop.x + lx, y + ly) : g.lineTo(drop.x + lx, y + ly)));
        g.closePath();
        g.fillPath();
      } else {
        // Health cross.
        g.fillRect(drop.x - 6, y - 2, 12, 4);
        g.fillRect(drop.x - 2, y - 6, 4, 12);
      }
    });
  }

  drawExplosions() {
    const g = this.explosionGraphics;
    g.clear();
    const now = this.time.now;
    for (let i = this.explosionFx.length - 1; i >= 0; i--) {
      const fx = this.explosionFx[i];
      const t = (now - fx.start) / EXPLOSION_FX_DURATION_MS;
      if (t >= 1) {
        this.explosionFx.splice(i, 1);
        continue;
      }
      const ringR = 10 + t * (fx.radius || RPG_EXPLOSION_RADIUS);
      g.lineStyle(3, 0xffb703, 1 - t);
      g.strokeCircle(fx.x, fx.y, ringR);

      const flashR = Math.max(0, 26 * (1 - t * 2));
      if (flashR > 0) {
        g.fillStyle(0xfff2c7, 0.9 * (1 - t));
        g.fillCircle(fx.x, fx.y, flashR);
      }

      g.fillStyle(0x55555a, 0.4 * (1 - t));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const d = t * (fx.radius || RPG_EXPLOSION_RADIUS) * 0.7;
        g.fillCircle(fx.x + Math.cos(a) * d, fx.y + Math.sin(a) * d, 3 + t * 3);
      }
    }
  }

  drawCrosshair() {
    const g = this.crosshairGraphics;
    g.clear();
    const localSm = this.stickmen.get(this.myId);
    if (!localSm || !localSm.alive) return;
    const x = this.localInput.mouseX;
    const y = this.localInput.mouseY;
    const gap = 6;
    const len = 6;
    g.lineStyle(2, 0x6ee7ff, 0.9);
    g.beginPath();
    g.moveTo(x - gap - len, y);
    g.lineTo(x - gap, y);
    g.moveTo(x + gap, y);
    g.lineTo(x + gap + len, y);
    g.moveTo(x, y - gap - len);
    g.lineTo(x, y - gap);
    g.moveTo(x, y + gap);
    g.lineTo(x, y + gap + len);
    g.strokePath();
    g.fillStyle(0x6ee7ff, 0.9);
    g.fillCircle(x, y, 1.5);
  }

  updateLocalHud() {
    const sm = this.stickmen.get(this.myId);
    if (!sm) return;
    this.onLocalHud({ hp: sm.hp, maxHp: sm.maxHp });
  }

  handleEvents(events) {
    events.forEach((e) => {
      if (e.type === 'hit') {
        this.stickmen.get(e.targetId)?.triggerHitFlash();
        if (e.attackerId === this.myId) this.onHitMarker();
      }
      if (e.type === 'kill') {
        this.onKillFeed({ attackerName: e.attackerName, targetName: e.targetName });
        if (e.attackerId === this.myId) this.onKillConfirm(e.targetName);
      }
      if (e.type === 'explosion') {
        this.explosionFx.push({ x: e.x, y: e.y, radius: e.radius, start: this.time.now });
        this.cameras.main.shake(140, 0.005);
      }
    });
  }

  updateWeaponHud(time) {
    const sm = this.stickmen.get(this.myId);
    if (!sm) return;
    const weaponKey = sm.activeWeaponKey;
    const weapon = WEAPONS[weaponKey];
    const last = sm.lastAttackAt[weaponKey] || 0;
    const cooldownRatio = weapon ? Math.min(1, (time - last) / weapon.cooldownMs) : 1;
    this.onWeaponHud({
      activeIndex: sm.activeWeaponIndex,
      cooldownRatio,
      alive: sm.alive,
    });
  }

  hostUpdate(time, delta) {
    this.playerConfigs.forEach((cfg) => {
      const sm = this.stickmen.get(cfg.id);
      if (!sm) return;
      const input = cfg.id === this.myId ? this.localInput : this.remoteInputs.get(cfg.id);
      const switchRequested = cfg.id === this.myId ? this._requestSwitch : input?.switchWeapon;
      const dashRequested = cfg.id === this.myId ? this._requestDash : input?.dash;
      if (!sm.alive) {
        sm.body.setVelocityX(0);
      } else if (input) {
        this.applyInputToStickman(sm, input, cfg.id, time, switchRequested, dashRequested);
      }
      if (cfg.id === this.myId) {
        this._requestSwitch = false;
        this._requestDash = false;
      }
    });

    this.updateProjectiles(delta);
    this.updateCrates(delta);

    this.broadcastTimer += delta;
    if (this.broadcastTimer > STATE_BROADCAST_MS) {
      this.broadcastTimer = 0;
      this.network.broadcast({ type: 'state', payload: this.buildStatePayload() });
      this.handleEvents(this.pendingEvents);
      this.pendingEvents = [];
    }
  }

  updateCrates(delta) {
    this.crateSpawnTimer += delta;
    if (this.crateSpawnTimer > this.crateSpawnDelay && this.crates.length < CRATE_MAX_ACTIVE) {
      this.crateSpawnTimer = 0;
      this.crateSpawnDelay = Phaser.Math.Between(CRATE_MIN_INTERVAL_MS, CRATE_MAX_INTERVAL_MS);
      this.spawnCrate();
    }

    const dt = delta / 1000;
    for (let i = this.crates.length - 1; i >= 0; i--) {
      const c = this.crates[i];
      if (c.state === 'falling') {
        c.y += CRATE_FALL_SPEED * dt;
        if (c.y >= c.targetY) {
          c.y = c.targetY;
          c.state = 'ready';
        }
      }
      // No auto-heal here — crates must be attacked open via damageCrate().
    }

    for (let i = this.drops.length - 1; i >= 0; i--) {
      const drop = this.drops[i];
      drop.ttl -= delta;
      if (drop.ttl <= 0) {
        this.drops.splice(i, 1);
        continue;
      }
      for (const sm of this.stickmen.values()) {
        if (!sm.alive) continue;
        // Compare against feet, not the hitbox center — drops sit near
        // ground level, and a taller size's center is much further from
        // the ground than a shorter one's, which made Medium/Adult unable
        // to reach any drop at all regardless of kind.
        const footY = sm.y + sm.sizeDef.hitboxHeight / 2;
        if (Phaser.Math.Distance.Between(drop.x, drop.y, sm.x, footY) > HEALTH_PICKUP_RADIUS) continue;
        if (drop.kind === 'heal') {
          if (sm.hp >= sm.maxHp) continue;
          sm.hp = Math.min(sm.maxHp, sm.hp + HEALTH_PICKUP_HEAL);
        } else if (drop.kind === 'speed') {
          sm.speedBoostUntil = this.time.now + BOOST_DURATION_MS;
          sm.speedBoostActive = true;
        } else if (drop.kind === 'damage') {
          sm.damageBoostUntil = this.time.now + BOOST_DURATION_MS;
          sm.damageBoostActive = true;
        } else if (drop.kind === 'shield') {
          sm.shieldUntil = this.time.now + BOOST_DURATION_MS;
          sm.shieldActive = true;
        }
        this.drops.splice(i, 1);
        break;
      }
    }

    for (const sm of this.stickmen.values()) {
      if (sm.speedBoostActive && this.time.now >= sm.speedBoostUntil) sm.speedBoostActive = false;
      if (sm.damageBoostActive && this.time.now >= sm.damageBoostUntil) sm.damageBoostActive = false;
      if (sm.shieldActive && this.time.now >= sm.shieldUntil) sm.shieldActive = false;
    }
  }

  spawnCrate() {
    const platform = Phaser.Utils.Array.GetRandom(this.arenaDef.platforms);
    const margin = Math.min(24, platform.w / 3);
    const x = platform.x + margin + Math.random() * Math.max(1, platform.w - margin * 2);
    this.crates.push({
      id: Math.random().toString(36).slice(2),
      x,
      y: -20,
      targetY: platform.y - 14,
      state: 'falling',
      hp: CRATE_HP,
    });
  }

  // Crates only reveal a health pack (or nothing) once broken open by an
  // attack — the box itself never auto-heals on touch.
  damageCrate(crate, dmg) {
    if (crate.state !== 'ready') return;
    crate.hp -= dmg;
    if (crate.hp > 0) return;
    this.crates = this.crates.filter((c) => c !== crate);
    if (Math.random() < CRATE_DROP_CHANCE) {
      const kind = Phaser.Utils.Array.GetRandom(DROP_KINDS);
      this.drops.push({ id: Math.random().toString(36).slice(2), x: crate.x, y: crate.y, ttl: DROP_ITEM_TTL_MS, kind });
    }
  }

  applyMovement(sm, input, time, dashRequested) {
    const speed = sm.sizeDef.moveSpeed * (sm.speedBoostActive ? SPEED_BOOST_MULTIPLIER : 1);

    if (dashRequested && sm.dashTimer <= 0 && time >= sm.dashCooldownUntil) {
      const dir = input.left ? -1 : input.right ? 1 : sm.facingDir;
      sm.dashTimer = DASH_DURATION_MS;
      sm.dashCooldownUntil = time + DASH_COOLDOWN_MS;
      sm.dashVX = dir * speed * DASH_SPEED_MULTIPLIER;
    }

    let vx;
    if (sm.dashTimer > 0) {
      vx = sm.dashVX;
    } else {
      vx = 0;
      if (input.left) vx -= speed;
      if (input.right) vx += speed;
    }
    sm.body.setVelocityX(vx);
    if (vx !== 0) sm.facingDir = vx > 0 ? 1 : -1;

    if (input.jump && sm.body.blocked.down) {
      sm.body.setVelocityY(sm.sizeDef.jumpVelocity);
    }

    if (typeof input.mouseX === 'number') {
      sm.facingAngle = Math.atan2(input.mouseY - sm.y, input.mouseX - sm.x);
    }
  }

  applyInputToStickman(sm, input, ownerId, time, switchRequested, dashRequested) {
    this.applyMovement(sm, input, time, dashRequested);
    if (switchRequested) sm.switchWeapon();
    if (input.attack) this.tryAttack(sm, ownerId, time);
  }

  tryAttack(sm, ownerId, time) {
    const weaponKey = sm.activeWeaponKey;
    if (!weaponKey) return;
    const weapon = WEAPONS[weaponKey];
    const last = sm.lastAttackAt[weaponKey] || 0;
    if (time - last < weapon.cooldownMs) return;
    sm.lastAttackAt[weaponKey] = time;
    sm.triggerAttackAnim();

    const dmg = sm.damageBoostActive ? Math.round(weapon.damage * DAMAGE_BOOST_MULTIPLIER) : weapon.damage;

    if (weapon.type === 'melee') {
      this.stickmen.forEach((other, otherId) => {
        if (otherId === ownerId || !other.alive) return;
        const dx = other.x - sm.x;
        const dy = other.y - sm.y;
        const dist = Math.hypot(dx, dy);
        if (dist > weapon.range) return;
        const angleTo = Math.atan2(dy, dx);
        const diff = Phaser.Math.Angle.Wrap(angleTo - sm.facingAngle);
        if (Math.abs(diff) > Phaser.Math.DegToRad(weapon.arcDegrees / 2)) return;
        this.damagePlayer(other, otherId, dmg, ownerId);
        other.body.setVelocity(Math.cos(angleTo) * weapon.knockback, Math.sin(angleTo) * weapon.knockback - 100);
      });
      this.crates.forEach((crate) => {
        if (crate.state !== 'ready') return;
        const dx = crate.x - sm.x;
        const dy = crate.y - sm.y;
        const dist = Math.hypot(dx, dy);
        if (dist > weapon.range) return;
        const angleTo = Math.atan2(dy, dx);
        const diff = Phaser.Math.Angle.Wrap(angleTo - sm.facingAngle);
        if (Math.abs(diff) > Phaser.Math.DegToRad(weapon.arcDegrees / 2)) return;
        this.damageCrate(crate, dmg);
      });
    } else {
      const speed = weapon.projectileSpeed;
      const pellets = weapon.pellets || 1;
      const spread = Phaser.Math.DegToRad(weapon.spreadDegrees || 0);
      for (let i = 0; i < pellets; i++) {
        const offset = pellets > 1 ? -spread / 2 + (spread * i) / (pellets - 1) : 0;
        const angle = sm.facingAngle + offset;
        this.projectiles.push({
          id: Math.random().toString(36).slice(2),
          x: sm.x + Math.cos(angle) * 30,
          y: sm.y + Math.sin(angle) * 30 - 10,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          gravityScale: weapon.gravityScale,
          damage: dmg,
          knockback: weapon.knockback,
          weaponKey,
          ownerId,
          ttl: 2000,
        });
      }
    }
  }

  damagePlayer(sm, id, dmg, attackerId) {
    if (!sm.alive) return;
    if (sm.shieldActive) dmg = Math.round(dmg * SHIELD_DAMAGE_REDUCTION);
    sm.hp -= dmg;
    this.pendingEvents.push({ type: 'hit', attackerId, targetId: id });
    if (sm.hp <= 0) {
      sm.hp = 0;
      sm.alive = false;
      sm.deaths++;
      sm.body.setVelocity(0, 0);
      sm.body.enable = false;
      const attacker = this.stickmen.get(attackerId);
      if (attacker && attacker !== sm) attacker.kills++;
      this.pendingEvents.push({
        type: 'kill',
        attackerId,
        targetId: id,
        attackerName: attacker?.name || '???',
        targetName: sm.name,
      });
      // Host decides the win: first to the kill target ends the match.
      if (this.isHost && attacker && attacker !== sm && attacker.kills >= this.killTarget) {
        this.endMatch(attackerId);
        return;
      }
      this.time.delayedCall(RESPAWN_DELAY_MS, () => this.respawn(sm));
    }
  }

  // Host-only: freeze the match, compute final standings, tell every client.
  endMatch(winnerId) {
    if (this.matchOver) return;
    this.matchOver = true;
    const standings = this.playerConfigs
      .map((cfg) => {
        const sm = this.stickmen.get(cfg.id);
        return {
          name: sm ? sm.name : cfg.name,
          kills: sm ? sm.kills : 0,
          deaths: sm ? sm.deaths : 0,
          color: sm ? sm.color : 0xffffff,
          isWinner: cfg.id === winnerId,
        };
      })
      .sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const payload = { standings, killTarget: this.killTarget };
    this.network.broadcast({ type: 'matchEnd', payload });
    this.onMatchEnd(payload);
  }

  respawn(sm) {
    sm.alive = true;
    sm.hp = sm.maxHp;
    sm.body.enable = true;
    sm.setPosition(sm.spawnPoint.x, sm.spawnPoint.y);
    sm.body.setVelocity(0, 0);
    sm.speedBoostActive = false;
    sm.damageBoostActive = false;
    sm.shieldActive = false;
  }

  updateProjectiles(delta) {
    const dt = delta / 1000;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.vy += PROJECTILE_GRAVITY * p.gravityScale * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.ttl -= delta;

      let remove = p.ttl <= 0 || p.x < 0 || p.x > ARENA_WIDTH || p.y > ARENA_HEIGHT;
      let impact = false;
      const isExplosive = !!WEAPONS[p.weaponKey]?.explosive;

      if (!remove) {
        for (const [id, sm] of this.stickmen) {
          if (id === p.ownerId || !sm.alive) continue;
          if (Phaser.Math.Distance.Between(p.x, p.y, sm.x, sm.y) < 18) {
            if (!isExplosive) {
              this.damagePlayer(sm, id, p.damage, p.ownerId);
              const ang = Math.atan2(p.vy, p.vx);
              const kb = p.knockback ?? 150;
              sm.body.setVelocity(Math.cos(ang) * kb, -Math.abs(kb) * 0.45);
            }
            remove = true;
            impact = true;
            break;
          }
        }
      }

      if (!remove) {
        for (const crate of this.crates) {
          if (crate.state !== 'ready') continue;
          if (Phaser.Math.Distance.Between(p.x, p.y, crate.x, crate.y) < CRATE_HIT_RADIUS) {
            if (!isExplosive) this.damageCrate(crate, p.damage);
            remove = true;
            impact = true;
            break;
          }
        }
      }

      if (!remove) {
        for (const plat of this.arenaDef.platforms) {
          if (p.x > plat.x && p.x < plat.x + plat.w && p.y > plat.y && p.y < plat.y + plat.h) {
            remove = true;
            impact = true;
            break;
          }
        }
      }

      if (remove) {
        if (isExplosive && impact) this.explode(p.x, p.y, p.ownerId, WEAPONS[p.weaponKey], p.damage);
        this.projectiles.splice(i, 1);
      }
    }
  }

  // Explosive rounds (RPG, grenade) don't do a single point-blank hit — they
  // deal falloff splash damage/knockback to everything (players + crates)
  // within blast radius, and emit an 'explosion' event so every client
  // renders the burst VFX. baseDamage is the projectile's own (possibly
  // damage-boosted) damage, not the static weapon definition's.
  explode(x, y, ownerId, weapon, baseDamage) {
    const radius = weapon.explosionRadius || RPG_EXPLOSION_RADIUS;
    this.pendingEvents.push({ type: 'explosion', x, y, radius });

    for (const [id, sm] of this.stickmen) {
      if (!sm.alive) continue;
      const dist = Phaser.Math.Distance.Between(x, y, sm.x, sm.y);
      if (dist > radius) continue;
      const falloff = Math.max(0.3, 1 - dist / radius);
      this.damagePlayer(sm, id, Math.round(baseDamage * falloff), ownerId);
      const ang = Math.atan2(sm.y - y, sm.x - x);
      const kb = weapon.knockback * falloff;
      sm.body.setVelocity(Math.cos(ang) * kb, Math.sin(ang) * kb - 120);
    }

    for (const crate of this.crates) {
      if (crate.state !== 'ready') continue;
      if (Phaser.Math.Distance.Between(x, y, crate.x, crate.y) > radius) continue;
      this.damageCrate(crate, baseDamage);
    }
  }

  drawProjectiles() {
    const g = this.projectileGraphics;
    g.clear();
    this.projectiles.forEach((p) => {
      // weaponKey (not a raw color field) travels over the network — the
      // color is a static lookup, no need to duplicate it on every packet.
      const color = WEAPONS[p.weaponKey]?.color ?? 0xffffff;
      const angle = p.angle !== undefined ? p.angle : Math.atan2(p.vy, p.vx);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const rot = (lx, ly) => [p.x + lx * cos - ly * sin, p.y + lx * sin + ly * cos];
      const poly = (pts, color, alpha = 1) => {
        g.fillStyle(color, alpha);
        g.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
        g.closePath();
        g.fillPath();
      };

      if (p.weaponKey === 'bow' || p.weaponKey === 'crossbow') {
        const [tailX, tailY] = rot(-16, 0);
        const [tipX, tipY] = rot(6, 0);
        g.lineStyle(2, 0x8a5a2b, 1);
        g.beginPath();
        g.moveTo(tailX, tailY);
        g.lineTo(tipX, tipY);
        g.strokePath();
        poly([rot(6, 0), rot(0, -2.5), rot(0, 2.5)], color);
        poly([rot(-16, 0), rot(-11, -4), rot(-11, 4)], 0xe8e6df);
        return;
      }

      if (p.weaponKey === 'throwingKnife') {
        poly([rot(8, 0), rot(-6, -2.5), rot(-2, 0), rot(-6, 2.5)], color);
        return;
      }

      if (p.weaponKey === 'rpg') {
        for (let i = 1; i <= 3; i++) {
          const [tx, ty] = rot(-6 - i * 7, 0);
          g.fillStyle(0x999999, 0.3 / i);
          g.fillCircle(tx, ty, 4 + i * 1.4);
        }
        poly([rot(-10, -3.4), rot(6, -3.4), rot(6, 3.4), rot(-10, 3.4)], 0x3a3a3a);
        poly([rot(6, -3.4), rot(13, 0), rot(6, 3.4)], color);
        return;
      }

      if (GRENADE_KEYS.includes(p.weaponKey)) {
        const r = p.weaponKey === 'heavyGrenade' ? 8 : p.weaponKey === 'stunGrenade' ? 5 : 6;
        g.fillStyle(color, 1);
        g.fillCircle(p.x, p.y, r);
        g.lineStyle(1, 0x1e2610, 0.8);
        g.strokeCircle(p.x, p.y, r);
        g.beginPath();
        g.moveTo(p.x - r, p.y);
        g.lineTo(p.x + r, p.y);
        g.moveTo(p.x, p.y - r);
        g.lineTo(p.x, p.y + r);
        g.strokePath();
        return;
      }

      // Default: bullet tracer — bright hot core with a fading streak behind it.
      const [trailX, trailY] = rot(-10, 0);
      g.lineStyle(2, color, 0.5);
      g.beginPath();
      g.moveTo(trailX, trailY);
      g.lineTo(p.x, p.y);
      g.strokePath();
      g.fillStyle(color, 0.9);
      g.fillCircle(p.x, p.y, 3.4);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(p.x, p.y, 1.6);
    });
  }

  buildStatePayload() {
    return {
      players: Array.from(this.stickmen.entries()).map(([id, sm]) => ({
        id,
        // x/y/facingAngle are rounded before send — 1px/hundredth-of-a-radian
        // precision doesn't matter visually but noticeably shrinks payload
        // size, which matters once this is fanned out to 5 clients ~14x/sec.
        x: Math.round(sm.x * 10) / 10,
        y: Math.round(sm.y * 10) / 10,
        hp: sm.hp,
        alive: sm.alive,
        facingAngle: Math.round(sm.facingAngle * 100) / 100,
        facingDir: sm.facingDir,
        activeWeaponIndex: sm.activeWeaponIndex,
        kills: sm.kills,
        deaths: sm.deaths,
        attacking: sm.attackAnimTimer > 0,
        dashing: sm.dashTimer > 0,
        speedBoosted: sm.speedBoostActive,
        damageBoosted: sm.damageBoostActive,
        shielded: sm.shieldActive,
        // maxHp and weapons are fixed at loadout and already known to every
        // client from the initial 'start' message — no need to resend them
        // every tick.
      })),
      projectiles: this.projectiles.map((p) => ({
        id: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        angle: Math.round(Math.atan2(p.vy, p.vx) * 100) / 100,
        weaponKey: p.weaponKey,
      })),
      events: this.pendingEvents,
      crates: this.crates.map((c) => ({ id: c.id, x: c.x, y: c.y, state: c.state })),
      drops: this.drops.map((d) => ({ id: d.id, x: d.x, y: d.y, ttl: d.ttl, kind: d.kind })),
    };
  }

  clientUpdate(time, delta) {
    // Predict our own movement immediately instead of waiting on a host
    // round-trip, so local controls feel responsive. Combat/attacks stay
    // host-authoritative and only take visual effect once confirmed.
    const localSm = this.stickmen.get(this.myId);
    if (localSm?.alive) {
      this.applyMovement(localSm, this.localInput, time, this._requestDash);
      if (this._requestSwitch) localSm.switchWeapon();
      if (this.localInput.attack && !this._wasAttacking) {
        localSm.triggerAttackAnim();
        // Approximate cooldown locally for immediate HUD feedback; the host
        // remains authoritative for whether the attack actually lands.
        localSm.lastAttackAt[localSm.activeWeaponKey] = time;
      }
    }
    this._wasAttacking = this.localInput.attack;

    if (localSm && localSm.correctionTargetX !== undefined) {
      const dx = localSm.correctionTargetX - localSm.x;
      const dy = localSm.correctionTargetY - localSm.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > 10000) {
        // Big jump (respawn, knockback) — snap instantly rather than crawl there.
        localSm.setPosition(localSm.correctionTargetX, localSm.correctionTargetY);
      } else if (distSq > 400) {
        localSm.setPosition(localSm.x + dx * 0.2, localSm.y + dy * 0.2);
      }
    }

    const lerpT = Math.min(1, delta / 90);
    this.stickmen.forEach((sm, id) => {
      if (id === this.myId || sm.targetX === undefined) return;
      sm.setPosition(Phaser.Math.Linear(sm.x, sm.targetX, lerpT), Phaser.Math.Linear(sm.y, sm.targetY, lerpT));
      sm.facingAngle = sm.targetFacingAngle;
      sm.facingDir = sm.targetFacingDir;
    });

    this.inputSendTimer += delta;
    if (this.inputSendTimer > INPUT_SEND_MS) {
      this.inputSendTimer = 0;
      this.network.sendToHost({
        type: 'input',
        payload: {
          left: this.localInput.left,
          right: this.localInput.right,
          jump: this.localInput.jump,
          attack: this.localInput.attack,
          mouseX: this.localInput.mouseX,
          mouseY: this.localInput.mouseY,
          switchWeapon: this._requestSwitch,
          dash: this._requestDash,
        },
      });
      this._requestSwitch = false;
      this._requestDash = false;
    }
  }

  applyState(payload) {
    payload.players.forEach((p) => {
      const sm = this.stickmen.get(p.id);
      if (!sm) return;
      sm.hp = p.hp;
      sm.alive = p.alive;
      sm.activeWeaponIndex = p.activeWeaponIndex;
      sm.kills = p.kills;
      sm.deaths = p.deaths;
      sm.speedBoostActive = p.speedBoosted;
      sm.damageBoostActive = p.damageBoosted;
      sm.shieldActive = p.shielded;
      if (p.attacking) sm.triggerAttackAnim();
      // Remote players don't run dash physics locally, so mirror the host's
      // "dashing" flag into the trail timer to show the afterimage/lean.
      // Skip our own avatar — its dash is already predicted locally.
      if (p.id !== this.myId && p.dashing) sm.showDash();

      if (p.id === this.myId) {
        sm.correctionTargetX = p.x;
        sm.correctionTargetY = p.y;
      } else {
        sm.targetX = p.x;
        sm.targetY = p.y;
        sm.targetFacingAngle = p.facingAngle;
        sm.targetFacingDir = p.facingDir;
      }
    });
    this.projectiles = payload.projectiles;
    this.handleEvents(payload.events || []);
    this.crates = payload.crates || [];
    this.drops = payload.drops || [];
  }

  updateScoreboardDOM() {
    if (!this.scoreboardEl) return;
    const rows = this.playerConfigs.map((cfg) => {
      const sm = this.stickmen.get(cfg.id);
      if (!sm) return '';
      return `<span class="score-entry">${sm.name}: ${sm.kills}K / ${sm.deaths}D</span>`;
    });
    this.scoreboardEl.innerHTML = rows.join('');
  }
}
