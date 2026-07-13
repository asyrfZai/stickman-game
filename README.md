# Stickman Brawl

Simple multiplayer stickman fighting game for up to 6 players. No backend — one player hosts, others join with a room code, gameplay runs browser-to-browser over WebRTC.

## Features

- Up to 6 players, peer-to-peer
- 3 body sizes, 20 weapons (pick 3), 3 arenas
- Supply crates with health & boost drops
- Dash, win condition + rematch
- Desktop and mobile controls

## Run

```bash
npm install
npm run dev
```

Open the printed URL (default `http://localhost:5173` or whtvr your port).

## Play with friends

1. Host clicks **Host Room** and shares the code.
2. Others click **Join Room** and enter it.
3. Host picks arena + kill target, then **Start Game**.

For internet play, tunnel the dev server (e.g. `ngrok http 5173` or whtvr tunnel u like).

## Controls

`A`/`D` move · `W` jump · `Space` dash · mouse aim · left click attack · `Q` switch weapon.
Mobile: on-screen buttons + drag to aim (landscape).

## Tech

Phaser 3 · Vite · PeerJS
