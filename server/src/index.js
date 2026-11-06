/* Ponto de entrada do Cloudflare Worker. A lógica fica em app.js (testável no Node com um D1 simulado em SQLite). */
import { createApp } from './app.js';

const app = createApp();
export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  scheduled: (event, env, ctx) => ctx.waitUntil(app.scheduled(event, env))
};
