'use strict';
/*
 * Driver da AMD com um clique, dentro da regra da AMD: o servidor dela só libera download que começa no amd.com.
 * O Nexo abre a página oficial de drivers numa janela escondida (sessão própria, sandbox), clica no botão oficial
 * "Download Windows Drivers" (o instalador de detecção automática da AMD, que acha a placa sozinho) e recebe o arquivo.
 * Nada de fingir referrer: o download sai da página da AMD de verdade. Se o botão não aparecer (a AMD mudou a página),
 * a janela aparece para a pessoa clicar. Chipset: a página abre visível para escolher a placa-mãe.
 */
const Silent = require('./silent-install.cjs');

const PAGE = 'https://www.amd.com/en/support/download/drivers.html';
/** Quanto a janela escondida espera o botão aparecer e o download começar antes de se mostrar. */
const HIDDEN_MS = 30000;
// A mesma regra de nome do motor de downloads (o que a página aceita, o motor também aceita).
const { SAFE_NAME } = require('./driver-download.cjs');

const hostOf = (url) => { try { const u = new URL(String(url)); return u.protocol === 'https:' ? u.hostname.toLowerCase() : null; } catch { return null; } };
/** Navegação permitida na janela: só https no amd.com e subdomínios. */
const allowedNav = (url) => { const h = hostOf(url); return Boolean(h) && (h === 'amd.com' || h.endsWith('.amd.com')); };
/**
 * Download aceito: só .exe de https://drivers.amd.com, com nome limpo (o Electron salva onde o Nexo mandar). No vídeo
 * (janela escondida), só o AMD Software: se a AMD trocar a ordem da página, outro instalador não passa.
 */
const allowedDownload = (url, fileName, { video = false } = {}) => {
  const name = String(fileName || '');
  if (hostOf(url) !== 'drivers.amd.com' || !SAFE_NAME.test(name) || !name.toLowerCase().endsWith('.exe')) return false;
  const profile = Silent.amdProfileFor(name);
  return video ? profile === 'amd' : profile !== null;
};
/** A janela da AMD não ganha câmera, microfone, localização, notificação nem nada (iframes de terceiros inclusive). */
function lockSession(ses) {
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
}
/** Janela nova pedida pela página: amd.com fica na mesma janela; fora dela, só com a janela visível (a pessoa vendo). */
function popupAction(url, { visible = false } = {}) {
  if (allowedNav(url)) return 'stay';
  return visible && hostOf(url) ? 'external' : 'deny';
}
const profileFor = (fileName) => Silent.amdProfileFor(fileName);
/** Vídeo: o instalador de detecção automática acha a placa sozinho. Chipset precisa escolher a placa-mãe na página. */
const hiddenFor = (id) => typeof id === 'string' && id.startsWith('video-');

/** Roda na página da AMD: acha o botão oficial de download do Windows e clica (o navegador manda o referrer de verdade). */
const PICK_SCRIPT = `(() => {
  const a = [...document.querySelectorAll('a[href]')].find((x) => /^https:\\/\\/drivers\\.amd\\.com\\/drivers\\/[^?#]+\\.exe$/i.test(x.href) && /adrenalin|minimalsetup/i.test(x.href));
  if (!a) return null;
  a.click();
  return a.href;
})()`;

module.exports = { PAGE, HIDDEN_MS, PICK_SCRIPT, allowedNav, allowedDownload, profileFor, hiddenFor, lockSession, popupAction };
