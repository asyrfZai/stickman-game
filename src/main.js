import './style.css';
import Phaser from 'phaser';
import { Network } from './net/network.js';
import { SIZES, SIZE_LIST, DEFAULT_SIZE } from './game/sizes.js';
import { WEAPONS, WEAPON_LIST, MAX_WEAPONS, getWeaponStats } from './game/weapons.js';
import { GameScene } from './game/GameScene.js';
import { PLAYER_COLORS, ARENA_LIST, DEFAULT_ARENA, KILL_TARGET_OPTIONS, DEFAULT_KILL_TARGET } from './game/arena.js';
import { drawStickFigure, hexToCss } from './game/drawStickFigure.js';

const screens = {
  main: document.getElementById('screen-main'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game'),
  results: document.getElementById('screen-results'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => el.classList.toggle('active', key === name));
}

// ---- Mobile view detection ----
// Narrow viewport OR a coarse (touch) pointer counts as "mobile" — the
// latter catches tablets that are wide enough to dodge a width breakpoint
// but still have no keyboard/mouse for the existing desktop controls.
function isMobileView() {
  return window.innerWidth <= 900 || window.matchMedia('(pointer: coarse)').matches;
}

function applyMobileClass() {
  document.documentElement.classList.toggle('is-mobile', isMobileView());
}

applyMobileClass();
window.addEventListener('resize', applyMobileClass);
window.addEventListener('orientationchange', applyMobileClass);

// Best-effort landscape lock — most browsers require fullscreen first, and
// several (notably iOS Safari) support neither; the CSS rotate-overlay in
// style.css is the reliable fallback that always works regardless.
async function enterFullscreenLandscape() {
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen();
    }
    if (screen.orientation?.lock) {
      await screen.orientation.lock('landscape');
    }
  } catch {
    // Ignored — falls back to the CSS rotate-overlay prompt. This also
    // covers the auto-attempt on game start silently failing for clients,
    // since receiving a network message isn't a user gesture and browsers
    // require one to grant fullscreen — the manual button below is a real
    // click, so it works reliably even when the auto-attempt didn't.
  }
}

async function tryLockLandscape() {
  if (!isMobileView()) return;
  await enterFullscreenLandscape();
}

function updateFullscreenButton() {
  const btn = document.getElementById('btnFullscreen');
  if (!btn) return;
  const isFullscreen = !!document.fullscreenElement;
  btn.textContent = isFullscreen ? '⤢' : '⛶';
  btn.title = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
}

document.addEventListener('fullscreenchange', () => {
  updateFullscreenButton();
  // The FIT scale mode listens for window resize, but toggling fullscreen
  // doesn't always fire one reliably on every browser — force a recompute
  // so the canvas immediately fills (or un-fills) the new #phaser-stage size.
  phaserGame?.scale.refresh();
});

// Android's on-screen chrome (nav/address bar) can show/hide while already
// in fullscreen, changing the effective viewport without a fullscreenchange
// event — keep the canvas locked to whatever space is actually available.
window.addEventListener('resize', () => {
  if (document.fullscreenElement) phaserGame?.scale.refresh();
});

document.getElementById('btnFullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) {
    document.exitFullscreen?.();
  } else {
    enterFullscreenLandscape();
  }
});

// ---- Menu state ----
let selectedSize = DEFAULT_SIZE;
let selectedWeapons = [];

const sizeChoicesEl = document.getElementById('sizeChoices');
const weaponChoicesEl = document.getElementById('weaponChoices');
const avatarCanvas = document.getElementById('avatarPreview');
const avatarCtx = avatarCanvas.getContext('2d');
const YOU_COLOR = hexToCss(PLAYER_COLORS[0]);

function refreshAvatarPreview() {
  drawStickFigure(avatarCtx, {
    width: avatarCanvas.width,
    height: avatarCanvas.height,
    sizeScale: SIZES[selectedSize].scale,
    colorCss: YOU_COLOR,
    weaponKeys: selectedWeapons,
  });
}

SIZE_LIST.forEach((size) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'choice-chip';
  chip.textContent = size.label;
  chip.dataset.key = size.key;
  if (size.key === selectedSize) chip.classList.add('selected');
  chip.addEventListener('click', () => {
    selectedSize = size.key;
    [...sizeChoicesEl.children].forEach((c) => c.classList.toggle('selected', c.dataset.key === selectedSize));
    refreshAvatarPreview();
  });
  sizeChoicesEl.appendChild(chip);
});

weaponChoicesEl.classList.add('weapon-row');
document.getElementById('weaponFieldLabel').textContent = `Weapons (pick up to ${MAX_WEAPONS})`;

function statBarHtml(label, value) {
  return `
    <div class="wc-stat">
      <label>${label}</label>
      <div class="wc-bar"><div class="wc-bar-fill" style="width:${value}%"></div></div>
    </div>`;
}

WEAPON_LIST.forEach((weapon) => {
  const stats = getWeaponStats(weapon);
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'weapon-card';
  card.dataset.key = weapon.key;
  card.innerHTML = `
    <span class="wc-badge"></span>
    <div class="wc-top">
      <span class="wc-name">${weapon.label}</span>
      <span class="wc-class">${weapon.type}</span>
    </div>
    <div class="wc-stats">
      ${statBarHtml('DMG', stats.damage)}
      ${statBarHtml('RATE', stats.rate)}
      ${statBarHtml('PWR', stats.power)}
      ${statBarHtml('RNG', stats.range)}
    </div>`;
  card.addEventListener('click', () => {
    const idx = selectedWeapons.indexOf(weapon.key);
    if (idx >= 0) {
      selectedWeapons.splice(idx, 1);
    } else if (selectedWeapons.length < MAX_WEAPONS) {
      selectedWeapons.push(weapon.key);
    } else {
      return;
    }
    refreshWeaponChips();
    refreshAvatarPreview();
  });
  weaponChoicesEl.appendChild(card);
});

function refreshWeaponChips() {
  [...weaponChoicesEl.children].forEach((c) => {
    const idx = selectedWeapons.indexOf(c.dataset.key);
    const isSelected = idx >= 0;
    c.classList.toggle('selected', isSelected);
    c.classList.toggle('disabled', !isSelected && selectedWeapons.length >= MAX_WEAPONS);
    c.dataset.slot = isSelected ? String(idx) : '';
    c.querySelector('.wc-badge').textContent = isSelected ? String(idx + 1) : '';
  });
}

// ---- Arena choice (host picks in the lobby; clients see it mirrored) ----
let selectedArena = DEFAULT_ARENA;
const arenaChoicesEl = document.getElementById('arenaChoices');

ARENA_LIST.forEach((arena) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'choice-chip arena-chip';
  chip.dataset.key = arena.key;
  chip.innerHTML = `<span class="arena-swatch" style="background:${hexToCss(arena.theme.platformTop)}"></span>${arena.label}`;
  if (arena.key === selectedArena) chip.classList.add('selected');
  chip.addEventListener('click', () => {
    if (!network?.isHost) return;
    selectedArena = arena.key;
    refreshArenaChoices();
    broadcastLobby();
  });
  arenaChoicesEl.appendChild(chip);
});

function refreshArenaChoices() {
  [...arenaChoicesEl.children].forEach((c) => c.classList.toggle('selected', c.dataset.key === selectedArena));
  arenaChoicesEl.classList.toggle('readonly', !network?.isHost);
}

// ---- Kill target (host picks in the lobby; clients see it mirrored) ----
let selectedKillTarget = DEFAULT_KILL_TARGET;
const killTargetChoicesEl = document.getElementById('killTargetChoices');

KILL_TARGET_OPTIONS.forEach((n) => {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'choice-chip arena-chip';
  chip.dataset.key = String(n);
  chip.textContent = String(n);
  if (n === selectedKillTarget) chip.classList.add('selected');
  chip.addEventListener('click', () => {
    if (!network?.isHost) return;
    selectedKillTarget = n;
    refreshKillTargetChoices();
    broadcastLobby();
  });
  killTargetChoicesEl.appendChild(chip);
});

function refreshKillTargetChoices() {
  [...killTargetChoicesEl.children].forEach((c) =>
    c.classList.toggle('selected', Number(c.dataset.key) === selectedKillTarget)
  );
  killTargetChoicesEl.classList.toggle('readonly', !network?.isHost);
}

function getProfile() {
  const nameInput = document.getElementById('playerName');
  const name = nameInput.value.trim() || `Player${Math.floor(Math.random() * 900 + 100)}`;
  return { name, size: selectedSize, weapons: [...selectedWeapons] };
}

function setMainError(msg) {
  document.getElementById('mainError').textContent = msg || '';
}

// ---- Networking / lobby state ----
let network = null;
let lobbyPlayers = new Map(); // id -> {id,name,size,weapons}
let hostId = null;
let phaserGame = null;
let gameStarted = false;

function weaponSummary(weapons) {
  return weapons && weapons.length ? weapons.join(' + ') : 'sword';
}

function renderLobby() {
  const list = document.getElementById('lobbyList');
  list.innerHTML = '';
  let index = 0;
  lobbyPlayers.forEach((p) => {
    const li = document.createElement('li');
    const isHostPlayer = p.id === hostId;
    const color = hexToCss(PLAYER_COLORS[index % PLAYER_COLORS.length]);
    li.innerHTML = `
      <canvas class="mini-avatar" width="50" height="64"></canvas>
      <span class="p-info">
        <span class="p-name">${p.name}${isHostPlayer ? ' (Host)' : ''}</span>
        <span class="p-loadout">${p.size} · ${weaponSummary(p.weapons)}</span>
      </span>
    `;
    list.appendChild(li);
    const miniCanvas = li.querySelector('.mini-avatar');
    drawStickFigure(miniCanvas.getContext('2d'), {
      width: miniCanvas.width,
      height: miniCanvas.height,
      sizeScale: (SIZES[p.size] || SIZES[DEFAULT_SIZE]).scale,
      colorCss: color,
      weaponKeys: p.weapons,
    });
    index++;
  });
  document.getElementById('lobbyHint').textContent = `${lobbyPlayers.size}/6 players connected`;
}

function broadcastLobby() {
  network.broadcast({
    type: 'lobby',
    payload: { hostId, arenaKey: selectedArena, killTarget: selectedKillTarget, players: Array.from(lobbyPlayers.values()) },
  });
  renderLobby();
}

async function hostGame() {
  setMainError('');
  if (selectedWeapons.length === 0) {
    setMainError('Pick at least 1 weapon.');
    return;
  }
  try {
    network = new Network();
    const code = await network.hostRoom();
    hostId = network.localId;
    gameStarted = false;
    lobbyPlayers = new Map();
    lobbyPlayers.set(hostId, { id: hostId, ...getProfile() });

    network.on('data', (fromId, msg) => {
      if (gameStarted) return;
      if (msg.type === 'profile') {
        lobbyPlayers.set(fromId, { id: fromId, ...msg.payload });
        broadcastLobby();
      }
    });
    network.on('client-disconnected', (id) => {
      if (gameStarted) return;
      lobbyPlayers.delete(id);
      broadcastLobby();
    });

    document.getElementById('roomCodeDisplay').textContent = code;
    document.getElementById('btnStartGame').classList.remove('hidden');
    refreshArenaChoices();
    refreshKillTargetChoices();
    renderLobby();
    showScreen('lobby');
  } catch (err) {
    setMainError(`Could not host room: ${err.message}`);
  }
}

async function joinGame(code) {
  setMainError('');
  if (selectedWeapons.length === 0) {
    setMainError('Pick at least 1 weapon.');
    return;
  }
  if (!code || code.trim().length < 3) {
    setMainError('Enter a valid room code.');
    return;
  }
  try {
    network = new Network();
    await network.joinRoom(code.trim());
    gameStarted = false;
    network.sendToHost({ type: 'profile', payload: getProfile() });

    network.on('data', (fromId, msg) => {
      if (msg.type === 'lobby') {
        hostId = msg.payload.hostId;
        selectedArena = msg.payload.arenaKey || DEFAULT_ARENA;
        selectedKillTarget = msg.payload.killTarget || DEFAULT_KILL_TARGET;
        lobbyPlayers = new Map(msg.payload.players.map((p) => [p.id, p]));
        refreshArenaChoices();
        refreshKillTargetChoices();
        renderLobby();
      } else if (msg.type === 'start') {
        gameStarted = true;
        startGameScene(msg.payload.players, false, msg.payload.arenaKey, msg.payload.killTarget);
      }
    });
    network.on('host-disconnected', () => {
      if (!gameStarted) {
        setMainError('Host disconnected.');
        returnToMainMenu();
      } else {
        alert('Host left the game.');
        returnToMainMenu();
      }
    });

    document.getElementById('roomCodeDisplay').textContent = network.roomCode;
    document.getElementById('btnStartGame').classList.add('hidden');
    refreshArenaChoices();
    refreshKillTargetChoices();
    showScreen('lobby');
  } catch (err) {
    setMainError(`Could not join room: ${err.message}`);
  }
}

function buildWeaponHud(weaponKeys) {
  const hud = document.getElementById('weaponHud');
  const keys = weaponKeys.length ? weaponKeys : ['sword'];
  hud.innerHTML = keys
    .map(
      (key) => `
        <div class="whud-slot">
          <div class="whud-icon" style="--wcolor:${hexToCss(WEAPONS[key].color)}"></div>
          <div class="whud-info">
            <span class="whud-name">${WEAPONS[key].label}</span>
            <div class="whud-bar"><div class="whud-bar-fill"></div></div>
          </div>
        </div>`
    )
    .join('');
  hud.classList.remove('hidden');
}

function updateWeaponHud({ activeIndex, cooldownRatio, alive }) {
  const hud = document.getElementById('weaponHud');
  if (!hud || !hud.children.length) return;
  hud.classList.toggle('hidden', !alive);
  [...hud.children].forEach((slot, i) => {
    const isActive = i === activeIndex;
    slot.classList.toggle('active', isActive);
    if (!isActive) return;
    const ready = cooldownRatio >= 1;
    slot.classList.toggle('ready', ready);
    slot.querySelector('.whud-bar-fill').style.width = `${Math.round(cooldownRatio * 100)}%`;
  });
}

function buildLocalHud(player, colorCss) {
  const panel = document.getElementById('localHudPanel');
  panel.innerHTML = `
    <div class="lhp-icon" style="--pcolor:${colorCss}"></div>
    <div class="lhp-info">
      <span class="lhp-name">${player.name}</span>
      <div class="lhp-bar"><div class="lhp-bar-fill"></div></div>
    </div>`;
  panel.classList.remove('hidden');
}

function updateLocalHud({ hp, maxHp }) {
  const fill = document.querySelector('#localHudPanel .lhp-bar-fill');
  if (!fill) return;
  const ratio = Math.max(0, hp / maxHp);
  fill.style.width = `${ratio * 100}%`;
  fill.style.background = ratio > 0.5 ? 'var(--success)' : ratio > 0.25 ? '#d6c452' : 'var(--danger)';
}

function flashHitMarker() {
  const el = document.getElementById('hitMarker');
  el.classList.remove('show');
  // Force a reflow so the animation restarts on rapid consecutive hits.
  void el.offsetWidth;
  el.classList.add('show');
}

function showKillBanner(targetName) {
  const el = document.getElementById('killBanner');
  el.textContent = `Eliminated ${targetName}`;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function pushKillFeed({ attackerName, targetName }) {
  const feed = document.getElementById('killFeed');
  const li = document.createElement('li');
  li.innerHTML = `<span class="kf-attacker">${attackerName}</span> eliminated <span class="kf-target">${targetName}</span>`;
  feed.appendChild(li);
  while (feed.children.length > 4) feed.removeChild(feed.firstChild);
  setTimeout(() => li.remove(), 4000);
}

function updateMatchTimer(elapsedMs) {
  const totalSec = Math.floor(elapsedMs / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  document.getElementById('matchTimer').textContent = `${mm}:${ss}`;
}

function showResults({ standings, killTarget }) {
  const winner = standings.find((s) => s.isWinner) || standings[0];
  const winnerEl = document.getElementById('resultsWinner');
  winnerEl.textContent = `${winner.name} wins!`;
  winnerEl.style.color = hexToCss(winner.color);
  document.getElementById('resultsSub').textContent = `First to ${killTarget} kills · Final standings`;

  const list = document.getElementById('resultsStandings');
  list.innerHTML = standings
    .map(
      (s, i) => `
      <li class="${s.isWinner ? 'winner' : ''}">
        <span class="rs-rank">${i + 1}</span>
        <span class="rs-name" style="color:${hexToCss(s.color)}">${s.name}</span>
        <span class="rs-kd">${s.kills} K / ${s.deaths} D</span>
      </li>`
    )
    .join('');

  document.getElementById('btnRematch').classList.toggle('hidden', !network?.isHost);
  document.getElementById('resultsHint').textContent = network?.isHost
    ? ''
    : 'Waiting for the host to start a rematch…';
  showScreen('results');
}

function startGameScene(players, isHost, arenaKey, killTarget) {
  // A rematch reuses the same network/lobby but spins up a fresh scene, so
  // tear down any prior Phaser instance before creating the new one.
  if (phaserGame) {
    phaserGame.destroy(true);
    phaserGame = null;
  }
  showScreen('game');
  tryLockLandscape();
  const localPlayer = players.find((p) => p.id === network.localId);
  const localIndex = players.indexOf(localPlayer);
  buildWeaponHud(localPlayer?.weapons || []);
  buildLocalHud(localPlayer, hexToCss(PLAYER_COLORS[localIndex % PLAYER_COLORS.length]));
  document.getElementById('killFeed').innerHTML = '';
  phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'phaser-container',
    backgroundColor: '#1b1c24',
    // FIT scales the canvas (via CSS) to fill whatever size #phaser-stage
    // computes to — capped at 960x540 on desktop, full viewport in mobile
    // fullscreen — while preserving the 16:9 aspect ratio the game's world
    // coordinates/camera zoom already assume. The internal resolution stays
    // 960x540 either way; only the on-screen size changes.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: 960,
      height: 540,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { y: 900 }, debug: false },
    },
    scene: [GameScene],
  });
  phaserGame.scene.start('GameScene', {
    network,
    isHost,
    myId: network.localId,
    players,
    arenaKey,
    killTarget,
    onHostLeft: () => {
      alert('Host left the game.');
      returnToMainMenu();
    },
    onWeaponHud: updateWeaponHud,
    onLocalHud: updateLocalHud,
    onHitMarker: flashHitMarker,
    onKillFeed: pushKillFeed,
    onKillConfirm: showKillBanner,
    onMatchTimer: updateMatchTimer,
    onMatchEnd: showResults,
  });

  // On some real devices the container's true size isn't settled yet at
  // the exact moment the canvas is created (e.g. a mobile toolbar still
  // resizing the viewport) — Phaser can end up fit-sizing against a stale
  // measurement. One more refresh after layout has had a frame to
  // stabilize keeps the canvas matched to #phaser-stage's actual size.
  requestAnimationFrame(() => phaserGame?.scale.refresh());
}

function returnToMainMenu() {
  gameStarted = false;
  if (phaserGame) {
    phaserGame.destroy(true);
    phaserGame = null;
  }
  if (network) {
    network.destroy();
    network = null;
  }
  lobbyPlayers = new Map();
  hostId = null;
  document.getElementById('weaponHud').innerHTML = '';
  document.getElementById('localHudPanel').classList.add('hidden');
  document.getElementById('killFeed').innerHTML = '';
  document.getElementById('matchTimer').textContent = '00:00';
  selectedArena = DEFAULT_ARENA;
  selectedKillTarget = DEFAULT_KILL_TARGET;
  refreshArenaChoices();
  refreshKillTargetChoices();
  showScreen('main');
}

// Host only: replay with the same lobby, arena and kill target.
function rematch() {
  if (!network?.isHost) return;
  const players = Array.from(lobbyPlayers.values());
  network.broadcast({ type: 'start', payload: { players, arenaKey: selectedArena, killTarget: selectedKillTarget } });
  startGameScene(players, true, selectedArena, selectedKillTarget);
}

// ---- Wire up buttons ----
document.getElementById('btnHost').addEventListener('click', hostGame);

document.getElementById('btnShowJoin').addEventListener('click', () => {
  document.getElementById('joinBox').classList.toggle('hidden');
});

document.getElementById('btnJoin').addEventListener('click', () => {
  joinGame(document.getElementById('joinCode').value);
});

document.getElementById('btnCopyCode').addEventListener('click', () => {
  const code = document.getElementById('roomCodeDisplay').textContent;
  navigator.clipboard?.writeText(code);
});

document.getElementById('btnStartGame').addEventListener('click', () => {
  if (!network?.isHost) return;
  gameStarted = true;
  const players = Array.from(lobbyPlayers.values());
  network.broadcast({ type: 'start', payload: { players, arenaKey: selectedArena, killTarget: selectedKillTarget } });
  startGameScene(players, true, selectedArena, selectedKillTarget);
});

document.getElementById('btnLeaveLobby').addEventListener('click', returnToMainMenu);
document.getElementById('btnLeaveGame').addEventListener('click', returnToMainMenu);
document.getElementById('btnRematch').addEventListener('click', rematch);
document.getElementById('btnLeaveResults').addEventListener('click', returnToMainMenu);

refreshWeaponChips();
refreshAvatarPreview();
refreshKillTargetChoices();
