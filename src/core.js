/* Núcleo: utilitários globais, barramento de eventos, estado compartilhado e atividades. */
const desktopBridge = window.nexoDesktop;

/*
 * Detecção de erros da interface (vão para o registro local; com "relatórios de erro" ligados, os de nível erro vão
 * para o criador). Pega mais que erro não tratado:
 *  - erros e promessas rejeitadas sem tratamento (com o stack);
 *  - console.error / console.warn do próprio app (ex.: um cartão de recurso que quebrou);
 *  - imagem, script ou folha de estilo do app que não carregou;
 *  - violação da política de segurança (CSP) — sinal de bug ou de algo tentando injetar conteúdo;
 *  - tela travada (tarefa longa de 2 s ou mais) e memória da tela perto do limite.
 * Mesma mensagem não repete na mesma abertura; no máximo 60 relatos por abertura. Nada digitado pela pessoa vai junto.
 */
(function watchErrors() {
  let sent = 0;
  const seen = new Set();
  const report = (message, stack, level = 'erro', extra = {}) => {
    if (sent >= 60 || !message) return;
    const key = `${level}|${String(message).slice(0, 160)}|${String(stack || '').split('\n')[1] || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    try { desktopBridge?.reportError?.({ level, message: String(message).slice(0, 600), stack: String(stack || '').slice(0, 4000), context: { tela: window.Nexo?.state?.view || null, ...extra } }); } catch { /* o registro nunca derruba a tela */ }
  };
  window.addEventListener('error', (event) => {
    // Recurso que não carregou (img/script/link): o alvo é o elemento, não a janela.
    const { target } = event;
    if (target && target !== window && target.tagName) {
      const url = String(target.src || target.href || '');
      if (/^(blob:|data:|https?:)/.test(url) && target.tagName === 'IMG') return; // capas e fotos da internet: falha comum, não é bug
      report(`Arquivo do app não carregou: <${target.tagName.toLowerCase()}> ${url.split(/[?#]/)[0].split('/').slice(-2).join('/')}`, '', 'aviso', { recurso: target.tagName.toLowerCase() });
      return;
    }
    report(event.message || event.error?.message, event.error?.stack || (event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : ''));
  }, true);
  window.addEventListener('unhandledrejection', (event) => report(event.reason?.message || String(event.reason), event.reason?.stack));
  document.addEventListener('securitypolicyviolation', (event) => report(`Bloqueado pela política de segurança: ${event.violatedDirective} (${String(event.blockedURI || 'inline').slice(0, 80)})`, '', 'erro', { diretiva: event.violatedDirective }));
  for (const [method, level] of [['error', 'erro'], ['warn', 'aviso']]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      try {
        const error = args.find((arg) => arg instanceof Error);
        const text = args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : typeof arg === 'string' ? arg : '')).filter(Boolean).join(' ').slice(0, 600);
        report(text || error?.message, error?.stack, level, { via: `console.${method}` });
      } catch { /* nunca quebra o console */ }
    };
  }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (entry.duration >= 2000) report(`A tela travou por ${(entry.duration / 1000).toFixed(1)} s`, '', 'aviso', { ms: Math.round(entry.duration) });
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* sem longtask */ }
  setInterval(() => {
    const { memory } = performance;
    if (memory?.jsHeapSizeLimit && memory.usedJSHeapSize / memory.jsHeapSizeLimit >= 0.85) report('A memória da tela passou de 85% do limite', '', 'aviso', { usadoMB: Math.round(memory.usedJSHeapSize / 1048576) });
  }, 5 * 60000);
  // Trilha: cada troca de tela vai para o processo principal (só o nome da tela).
  setTimeout(() => window.Nexo?.on?.('view', (name) => { try { desktopBridge?.crumb?.('tela', name); } catch { /* sem ponte */ } }), 0);
})();
/*
 * Estilos dinâmicos sem 'unsafe-inline' na política de segurança: o HTML gerado pelo app usa data-css="prop: valor; …"
 * e isto aplica pelo CSSOM (que a política permite), logo que o elemento entra na página — antes de a tela ser pintada.
 */
(function dynamicStyles() {
  const apply = (element) => {
    const text = element.getAttribute('data-css');
    if (text === null) return;
    element.removeAttribute('data-css');
    for (const part of text.split(';')) {
      const colon = part.indexOf(':');
      if (colon > 0) element.style.setProperty(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
  };
  const scan = (node) => { if (node.nodeType !== 1) { return; } apply(node); node.querySelectorAll('[data-css]').forEach(apply); };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') apply(record.target);
      else record.addedNodes.forEach(scan);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-css'] });
  scan(document.documentElement);
})();
const Nexo = (window.Nexo = {
  state: { snapshot: null, sensors: null, processes: null, cleanup: null, power: null, view: 'home' },
  keys: {
    activity: 'nexo-activity',
    autoClean: 'nexo-auto-clean',
    autoCleanLastRun: 'nexo-auto-clean-last-run',
    history: 'nexo-performance-history',
    feedback: 'nexo-recommendation-feedback',
    brain: 'nexo-brain-v1',
    effects: 'nexo-effects',
    journal: 'nexo-journal-v1',
    profile: 'nexo-profile',
    sessions: 'nexo-sessions-v1',
    lab: 'nexo-lab-v1'
  },
  listeners: {},
  on(event, handler) {
    this.listeners[event] ??= [];
    this.listeners[event].push(handler);
  },
  emit(event, payload) { for (const handler of this.listeners[event] || []) { try { handler(payload); } catch (error) { console.error(error); } } }
});

/* Plataforma: Windows ou Linux. O agente do Electron diz qual; a prévia de desenvolvimento pode forçar. */
Nexo.platform = window.__nexoPlatform || (/Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent) ? 'linux' : 'win32');
document.body.dataset.platform = Nexo.platform;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function readJSON(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function setAppStatus(message) { setText('app-status-label', message); }

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (!button.dataset.idleText) button.dataset.idleText = button.textContent;
  button.disabled = busy;
  button.textContent = busy ? label : button.dataset.idleText;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(unit === 0 ? 0 : 1).replace('.', ',')} ${units[unit]}`;
}

function formatUptime(seconds) {
  const totalMinutes = Math.max(0, Math.floor((Number(seconds) || 0) / 60));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} d ${hours} h`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

function formatRelative(timestamp, now = Date.now()) {
  const minutes = Math.round((now - timestamp) / 60000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.round(hours / 24);
  return `há ${days} dia${days > 1 ? 's' : ''}`;
}

let toastTimer;
/** Mostra uma mensagem rápida. `action` ({ label, run }) adiciona um botão, como "Desfazer". */
function showToast(message, action = null) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.replaceChildren();
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(text);
  if (action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = action.label;
    button.addEventListener('click', () => { toast.classList.remove('visible'); action.run(); });
    toast.append(button);
  }
  toast.classList.toggle('interactive', Boolean(action));
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), action ? 9000 : 3600);
}

function iconUse(id) { return `<svg aria-hidden="true"><use href="#${id}"/></svg>`; }

/* ---------- Atividades (as últimas 20 ações, só neste PC) ---------- */
function recordActivity(title, detail) {
  const entries = readJSON(Nexo.keys.activity, []);
  const list = Array.isArray(entries) ? entries : [];
  const [last] = list;
  // Repetições seguidas (ex.: "Análise inteligente · nada preocupante") viram uma linha só, com contador.
  if (last && last.title === String(title) && last.detail === String(detail) && Date.now() - last.timestamp < 12 * 3600e3) { last.timestamp = Date.now(); last.count = (Number(last.count) || 1) + 1; }
  else list.unshift({ title: String(title), detail: String(detail), timestamp: Date.now() });
  if (!writeJSON(Nexo.keys.activity, list.slice(0, 20))) showToast('Atividade registrada apenas nesta sessão.');
  renderActivity(list.slice(0, 20));
}

/** Desenha a lista de atividades recentes, juntando repetições seguidas numa linha só. */
function renderActivity(entries = readJSON(Nexo.keys.activity, [])) {
  const list = document.getElementById('activity-list');
  if (!list) return;
  const valid = (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry.title === 'string' && Number.isFinite(entry.timestamp))
    .reduce((acc, entry) => { const prev = acc[acc.length - 1]; if (prev && prev.title === entry.title && prev.detail === entry.detail) { prev.count = (prev.count || 1) + (Number(entry.count) || 1); } else { acc.push({ ...entry }); } return acc; }, []).slice(0, 20);
  list.replaceChildren(...valid.map((entry) => {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const meta = document.createElement('span');
    label.textContent = entry.title;
    const when = new Date(entry.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const repeated = entry.count > 1 ? ` · ${entry.count} vezes` : '';
    meta.textContent = `${when} · ${entry.detail || ''}${repeated}`;
    item.append(label, meta);
    return item;
  }));
}

/* ---------- Diário de alterações (módulo puro em src/journal.js) ---------- */
Nexo.journal = NexoJournal.create({
  get: () => readJSON(Nexo.keys.journal, []),
  set: (entries) => { if (!writeJSON(Nexo.keys.journal, entries)) showToast('Não foi possível salvar o diário de alterações neste computador.'); }
});
