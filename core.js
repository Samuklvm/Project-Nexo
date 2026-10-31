/* Núcleo: utilitários globais, barramento de eventos, estado compartilhado e atividades. */
const desktopBridge = window.nexoDesktop;
const Nexo = (window.Nexo = {
  state: { snapshot: null, sensors: null, processes: null, cleanup: null, power: null, view: 'home' },
  keys: {
    activity: 'nexo-activity',
    autoClean: 'nexo-auto-clean',
    autoCleanLastRun: 'nexo-auto-clean-last-run',
    history: 'nexo-performance-history',
    feedback: 'nexo-recommendation-feedback',
    brain: 'nexo-brain-v1',
    effects: 'nexo-effects'
  },
  listeners: {},
  on(event, handler) { (this.listeners[event] ||= []).push(handler); },
  emit(event, payload) { for (const handler of this.listeners[event] || []) { try { handler(payload); } catch (error) { console.error(error); } } }
});

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
function showToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

function iconUse(id) { return `<svg aria-hidden="true"><use href="#${id}"/></svg>`; }

/* ---------- Atividades (as últimas 20 ações, só neste PC) ---------- */
function recordActivity(title, detail) {
  const entries = readJSON(Nexo.keys.activity, []);
  const list = Array.isArray(entries) ? entries : [];
  list.unshift({ title: String(title), detail: String(detail), timestamp: Date.now() });
  if (!writeJSON(Nexo.keys.activity, list.slice(0, 20))) showToast('Atividade registrada apenas nesta sessão.');
  renderActivity(list.slice(0, 20));
}

function renderActivity(entries = readJSON(Nexo.keys.activity, [])) {
  const list = document.getElementById('activity-list');
  if (!list) return;
  const valid = (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry.title === 'string' && Number.isFinite(entry.timestamp)).slice(0, 20);
  list.replaceChildren(...valid.map((entry) => {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const meta = document.createElement('span');
    label.textContent = entry.title;
    meta.textContent = `${new Date(entry.timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · ${entry.detail || ''}`;
    item.append(label, meta);
    return item;
  }));
}
