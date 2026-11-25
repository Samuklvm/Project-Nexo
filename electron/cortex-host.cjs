/*
 * Peças do Cortex que dependem do app (processo principal), separadas do main.cjs para dar para testar:
 *   createBusy               o que a pessoa está rodando (inclusive sessão de observação e medição de FPS) e que
 *                            impede o Cortex de pesar junto
 *   createGameInForeground   "tem jogo em primeiro plano?" — da sonda de sessão, se ela mandou amostra há pouco;
 *                            senão uma consulta única (PowerShell no Windows, xprop no Linux)
 *   createIsGame             "este processo (só o nome, como no culprit dos minutos) é um jogo?" — a mesma regra do
 *                            app: biblioteca de jogos pelo nome do executável, depois src/session.js classifyForeground;
 *                            mais os nomes que a sonda ou o observador já viram como jogo em primeiro plano (learn)
 */
'use strict';

const PROBE_FRESH_MS = 60000;

/**
 * Ocupado = lab, otimização, benchmark, análise profunda ou teste com reinício da pessoa, ou uma sessão de observação
 * gravando (sonda) ou a medição de FPS (PresentMon/MangoHud) rodando: a pessoa está jogando ou medindo. Leitura que
 * falha não trava.
 */
function createBusy({ labRunning, optRunning, benchActive, deepRunning, rebootActive, probeRunning = () => false, fpsRunning = () => false }) {
  const flag = (fn) => { try { return Boolean(fn()); } catch { return false; } };
  return async () => Boolean(labRunning() || optRunning() || benchActive() || deepRunning() || flag(probeRunning) || flag(fpsRunning)
    || await Promise.resolve().then(rebootActive).catch(() => false));
}

/**
 * lastProbe() → { at, sample } da última amostra da sonda (at = quando chegou). Amostra de até 60 s vale no lugar da
 * consulta: a sonda já está olhando o primeiro plano a cada 4 s, sem custo a mais. Sem primeiro plano na amostra = null.
 */
function createGameInForeground({ now = Date.now, lastProbe, query }) {
  return async () => {
    const last = lastProbe();
    if (last && last.sample && Number.isFinite(last.at) && now() - last.at <= PROBE_FRESH_MS) {
      const fg = last.sample.fg;
      return fg ? fg.isGame === true : null;
    }
    return query();
  };
}

const plainName = (name) => String(name || '').trim().toLowerCase().replace(/\.exe$/, '');

/**
 * matchName(nome) → jogo da biblioteca ({ kind }) ou null; classify({ name }) → { isGame } (session.js). Só com o nome
 * o classify não vê pasta nem tela cheia, então a biblioteca e o que a sonda já viu é que pegam jogos com anticheat.
 * Leitura que falha conta como "não é jogo" (aí a lentidão abre investigação, como antes).
 */
function createIsGame({ matchName = () => null, classify = () => ({ isGame: false }) } = {}) {
  const seen = new Set(); // em ordem de chegada: o teto (SEEN_MAX) tira os mais antigos
  let onNew = null;
  const isGame = (name) => {
    const plain = plainName(name);
    if (plain.length < 2) return false;
    if (seen.has(plain)) return true;
    try {
      const game = matchName(String(name));
      if (game) return game.kind !== 'app';
    } catch { /* biblioteca indisponível */ }
    try { return Boolean(classify({ name: String(name) })?.isGame); } catch { return false; }
  };
  /** Um nome que a sonda (ou o observador) viu como jogo em primeiro plano. */
  isGame.learn = (name) => {
    const plain = plainName(name);
    if (plain.length < 2 || seen.has(plain)) return;
    seen.add(plain);
    while (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    if (onNew) try { onNew([...seen]); } catch { /* guardar é opcional */ }
  };
  /** Carrega nomes guardados (sem avisar) e passa a avisar `save(nomes)` a cada nome novo aprendido. */
  isGame.persist = (names, save) => {
    for (const n of Array.isArray(names) ? names : []) { const plain = plainName(n); if (plain.length >= 2) seen.add(plain); }
    while (seen.size > SEEN_MAX) seen.delete(seen.values().next().value);
    onNew = typeof save === 'function' ? save : null;
  };
  return isGame;
}

const SEEN_KEY = 'cortex.jogos-vistos';
const SEEN_MAX = 200;
/** Liga o isGame à memória do Cortex: os jogos que a sonda viu sobrevivem ao reinício (meta, ≤ 200, minúsculos). */
function bindGameMemory(isGame, memory) {
  let names = [];
  try { const v = JSON.parse(memory.getMeta(SEEN_KEY) || '[]'); if (Array.isArray(v)) names = v.filter((n) => typeof n === 'string'); } catch { /* meta estragado: recomeça */ }
  isGame.persist(names, (all) => { memory.setMeta(SEEN_KEY, JSON.stringify(all)); });
}

module.exports = { createBusy, createGameInForeground, createIsGame, bindGameMemory, PROBE_FRESH_MS };
