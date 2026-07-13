import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Allow tunneling this dev server through ngrok for testing multiplayer
    // with friends over the internet (ngrok gives a random *.ngrok-free.app
    // or *.ngrok.io hostname each run).
    allowedHosts: ['.ngrok-free.app', '.ngrok.io', '.ngrok.app'],
  },
});
