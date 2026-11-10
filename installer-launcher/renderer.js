const $ = (s) => document.querySelector(s);
const scr = [...document.querySelectorAll('.scr')];
let running = false;
const EN={"Sensores de temperatura (Windows): na primeira abertura, com a sua permissão (UAC), o Nexo instala o driver PawnIO (assinado, código aberto, o mesmo do LibreHardwareMonitor; baixado do GitHub oficial com o arquivo conferido) e o serviço “Nexo Device Care: sensores”, que só lê sensores e responde ao app por um canal local. Desinstalar o Nexo remove o serviço e o PawnIO, se foi o Nexo que instalou.": "Temperature sensors (Windows): on first launch, with your permission (UAC), Nexo installs the PawnIO driver (signed, open source, the same one LibreHardwareMonitor uses; downloaded from the official GitHub with the file verified) and the “Nexo Device Care: sensores” service, which only reads sensors and answers the app through a local channel. Uninstalling Nexo removes the service, and PawnIO if Nexo installed it.", "Cuide do seu PC": "Care for your PC", "sob as estrelas.": "under the stars.", "Análise que aprende a sua rotina, limpeza segura e monitoramento — tudo feito localmente.": "Analysis that learns your routine, safe cleanup and monitoring — all done locally.", "Li e aceito os": "I have read and accept the", "Avisos e a Privacidade": "Notices and Privacy", "Opções": "Options", "Instalar": "Install", "Opções de instalação": "Install options", "Pasta de destino": "Destination folder", "Alterar": "Change", "Atalho na área de trabalho": "Desktop shortcut", "Abrir o Nexo ao terminar": "Open Nexo when finished", "Compartilhar dados opcionais com o criador": "Share optional data with the creator", "O que o Nexo guarda neste PC?": "What does Nexo store on this PC?", "Voltar": "Back", "Preparando arquivos…": "Preparing files…", "Copiando o Nexo…": "Copying Nexo…", "Configurando sensores…": "Setting up sensors…", "Criando atalhos…": "Creating shortcuts…", "Finalizando…": "Finishing…", "Fechar": "Close", "Tentar de novo": "Try again", "Tudo pronto.": "All set.", "O Nexo Device Care foi instalado com sucesso.": "Nexo Device Care was installed successfully.", "Abrir o Nexo": "Open Nexo", "Avisos e privacidade": "Notices and privacy", "Avisos": "Notices", "Os indicadores e as recomendações são heurísticos: não garantem ganho de desempenho nem substituem avaliação técnica.": "Indicators and recommendations are heuristic: they do not guarantee a performance gain or replace a technical assessment.", "A limpeza mostra uma prévia e só mexe em arquivos antigos. Esvaziar a Lixeira, se você escolher, não pode ser desfeito.": "Cleanup shows a preview and only touches old files. Emptying the Recycle Bin, if you choose it, cannot be undone.", "Otimizar unidades e verificar arquivos do Windows usam ferramentas nativas e podem pedir permissão de administrador.": "Drive optimization and Windows file checks use native tools and may ask for administrator permission.", "O que o Nexo guarda neste PC (nada sai dele)": "What Nexo stores on this PC (none of it leaves it)", "Painel: nome do computador, versões do Windows e do app, tempo ligado, uso de CPU, RAM e discos, temperaturas e uso da GPU quando houver sensor.": "Dashboard: computer name, Windows and app versions, uptime, CPU, RAM and disk use, temperatures and GPU use when a sensor exists.", "Diagnóstico: nome e uso dos programas que mais consomem. Durante lentidões, só o nome do programa é guardado (sem caminho nem linha de comando).": "Diagnostics: name and use of the heaviest programs. During slowdowns, only the program name is stored (no path or command line).", "Aprendizado local: amostras por minuto (até 7 dias), médias por hora da semana, lentidões detectadas e até 60 programas recorrentes.": "Local learning: per-minute samples (up to 7 days), averages by hour of the week, detected slowdowns and up to 60 recurring programs.", "Limpeza e otimização: caminho, tamanho e quantidade de arquivos antigos; plano de energia e programas de inicialização, lidos só para exibir.": "Cleanup and optimization: path, size and count of old files; power plan and startup programs, read for display only.", "Preferências: avaliações das sugestões (até 100), últimas 20 atividades e o papel de parede escolhido.": "Preferences: suggestion ratings (up to 100), last 20 activities and the chosen wallpaper.", "Tudo pode ser exportado ou apagado em Ajustes.": "Everything can be exported or erased in Settings.", "Rede e compartilhamento": "Network and sharing", "Ao abrir, o app consulta as releases públicas do GitHub, que pode receber dados normais da conexão (como o IP). O download só começa por ação sua.": "On launch, the app checks public GitHub releases; GitHub may receive normal connection data (such as the IP). Downloads only start when you ask.", "Desinstalação": "Uninstalling", "Política completa no GitHub": "Full policy on GitHub", "Entendi": "Got it", "Diário de alterações: o que o Nexo mudou (operação, horário, valor anterior e novo) e o resultado de testes curtos de CPU que você pedir (até 100 registros).": "Change journal: what Nexo changed (operation, time, previous and new value) and the result of short CPU tests you ask for (up to 100 records).", "Sessões de observação que você iniciar: uso do sistema, nome do programa em primeiro plano e dos que mais pesaram (sem caminhos) e, se você ativar, o FPS pelo PresentMon (Intel, MIT). Até 10 sessões; você pode apagar.": "Observation sessions you start: system use, name of the foreground program and of the heaviest ones (no paths) and, if you enable it, FPS through PresentMon (Intel, MIT). Up to 10 sessions; you can erase them.", "Desinstalar pelo Windows, ou por Ajustes, remove o programa, os dados, as preferências, os atalhos, as entradas do Registro e os planos de energia criados pelo laboratório. Atualizações preservam os seus dados.": "Uninstalling through Windows, or through Settings, removes the program, data, preferences, shortcuts, Registry entries and the power plans created by the lab. Updates keep your data.", "Recursos opcionais": "Optional features", "Otimização extrema (beta) é uma opção arriscada e só roda com o seu consentimento reforçado: o Nexo testa sozinho ajustes ocultos do processador num plano de energia temporário, cria antes um ponto de restauração (pede administrador), para na hora se algo esquentar ou der erro e volta ao original no fim. Pode aquecer o PC e, em casos raros, exigir reiniciar.": "Extreme optimization (beta) is a risky option and only runs with your reinforced consent: Nexo tests hidden processor settings on its own in a temporary power plan, first creates a restore point (asks for administrator), stops at once if anything overheats or errors and returns to the original at the end. It may heat up the PC and, in rare cases, require a restart.", "Sessão automática, bandeja e iniciar com o Windows: desligados até você ligar. O observador lê o programa em primeiro plano a cada 3 s, sem guardar caminhos.": "Automatic sessions, tray and start with Windows: off until you turn them on. The watcher reads the foreground program every 3 s, without storing paths.", "Liberar o FPS: com a sua permissão, coloca o seu usuário no grupo Performance Log Users (dá para desfazer).": "Unlock FPS: with your permission, adds your user to the Performance Log Users group (can be undone).", "Biblioteca de jogos: lê os manifestos dos launchers, o Registro e as pastas dos jogos e copia as capas do cache local. Buscar capas oficiais na Steam e na Microsoft Store é opcional e começa desligado.": "Game library: reads launcher manifests, the Registry and game folders and copies covers from the local cache. Fetching official covers from Steam and the Microsoft Store is optional and starts off.", "Contas de jogos (opcionais): Steam deste PC (só arquivos locais), chave da Steam Web API, conta Xbox pelo navegador (tokens descartados) e Discord pelo canal local. O que fica guardado é cifrado neste PC.": "Game accounts (optional): Steam on this PC (local files only), Steam Web API key, Xbox account through the browser (tokens discarded) and Discord through its local channel. Anything stored is encrypted on this PC.", ". A telemetria é opcional e começa desativada; os relatórios de erro vão sempre, sem nada pessoal.": ". Telemetry is optional and starts off; error reports are always sent, with nothing personal.", "Telemetria anônima, um resumo por dia. Desativado por padrão.": "Anonymous telemetry, one summary per day. Off by default.", "Conta Google (opcional): login no seu navegador; ficam neste PC, cifrados, só nome, e-mail, identificador da conta e foto, sem senhas nem tokens do Google. Com a conta entrada, o e-mail vai junto dos relatórios de erro para o criador avisar quando corrigir; dá para desmarcar em Ajustes.": "Google account (optional): sign-in in your browser; only name, email, account identifier and photo stay on this PC, encrypted, with no Google passwords or tokens. With the account signed in, the email goes along with error reports so the creator can tell you when it is fixed; you can untick it in Settings.", "Servidor do Nexo: os relatórios de erro vão sempre (o erro e os últimos passos do app antes dele, sem o seu usuário, as suas pastas ou o que você digitou). A telemetria (um resumo anônimo do dia, sem nomes, pastas, programas nem e-mail) e a sincronização entre PCs (com a conta Google) são opcionais e começam desligadas. Marcar “Compartilhar dados opcionais com o criador” liga a telemetria; dá para mudar em Ajustes.": "Nexo server: error reports are always sent (the error and the app's last steps before it, without your user name, your folders or anything you typed). Telemetry (an anonymous summary of the day, with no names, folders, programs or email) and sync between PCs (with the Google account) are optional and start off. Checking “Share optional data with the creator” turns on telemetry; you can change it in Settings."};
let lang = (navigator.language || 'pt').toLowerCase().startsWith('pt') ? 'pt' : 'en';
const t = (s) => (lang === 'en' && EN[s] ? EN[s] : s);
const srcText = new WeakMap();

/** Troca os textos da janela entre português e inglês (guarda o original de cada nó na primeira vez). */
function applyLang() {
  const walker = document.createTreeWalker(document.querySelector('.win'), NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!srcText.has(n)) {
      const key = n.nodeValue.trim();
      if (!EN[key]) continue;
      srcText.set(n, n.nodeValue);
    }
    const raw = srcText.get(n);
    const key = raw.trim();
    n.nodeValue = lang === 'en' ? raw.replace(key, EN[key]) : raw;
  }
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR';
  $('#lang').textContent = lang === 'en' ? 'PT' : 'EN';
  $('#lang').setAttribute('aria-label', lang === 'en' ? 'Idioma: português' : 'Language: English');
  if (running) set(lastPct);
  else if (errCode !== null) showError();
}
$('#lang').onclick = () => {
  lang = lang === 'en' ? 'pt' : 'en';
  applyLang();
};

const M = [[0, 'Preparando arquivos…'], [25, 'Copiando o Nexo…'], [55, 'Configurando sensores…'], [80, 'Criando atalhos…'], [95, 'Finalizando…']];
let dir = null;
const go = (n) => scr.forEach((s, i) => s.classList.toggle('on', i === n));
let lastPct = 0;
let errCode = null;
const showError = () => {
  $('#st').textContent = lang === 'en' ? `Something went wrong during installation (code ${errCode}).` : `Algo deu errado na instalação (código ${errCode}).`;
};
const set = (p) => {
  lastPct = p;
  $('#fill').style.width = `${p}%`;
  $('#pct').textContent = `${p}%`;
  $('#st').textContent = t(M.filter((m) => p >= m[0]).pop()[1]);
};

/** Instala com as opções escolhidas; uma falha da instalação (ou do canal com o processo principal) vira o aviso de erro. */
async function start() {
  if (running) return;
  if (!$('#agree').checked) {
    go(0);
    return;
  }
  running = true;
  $('#err').hidden = true;
  set(0);
  go(2);
  let result;
  try {
    result = await nexo.install({ dir, desktop: $('#o-desk').checked, runAfter: $('#o-run').checked, telemetry: $('#o-tel').checked });
  } catch {
    result = { ok: false, code: 'ipc' };
  }
  running = false;
  if (!result?.ok) {
    errCode = result?.code ?? 'desconhecido';
    showError();
    $('#err').hidden = false;
    return;
  }
  set(100);
  setTimeout(() => {
    go(3);
    if ($('#o-run').checked) setTimeout(() => nexo.openApp(), 1500);
  }, 600);
}
document.querySelectorAll('[data-go]').forEach((b) => {
  b.onclick = () => {
    const n = Number(b.dataset.go);
    if (n === 2) start();
    else go(n);
  };
});
$('#retry').onclick = start;
$('#open').onclick = () => nexo.openApp();
const closeWindow = () => nexo.close();
$('#close2').onclick = closeWindow;
$('#close3').onclick = closeWindow;
$('#x').onclick = closeWindow;
$('#min').onclick = () => nexo.minimize();
$('#pick').onclick = async () => {
  const d = await nexo.pickDir().catch(() => null);
  if (d) {
    dir = d;
    $('#dir').textContent = d;
  }
};
const agree = $('#agree');
const gated = [...document.querySelectorAll('.pri[data-go="2"]')];
const syncAgree = () => gated.forEach((b) => {
  b.disabled = !agree.checked;
});
syncAgree();
agree.onchange = syncAgree;
const openNotices = () => {
  $('#notices').hidden = false;
  $('#close-notices').focus();
};
$('#open-notices').onclick = openNotices;
$('#pl').onclick = openNotices;
$('#close-notices').onclick = () => {
  $('#notices').hidden = true;
};
$('#notices-policy').onclick = () => nexo.openLink('privacy');
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#notices').hidden = true;
});
nexo.onProgress(set);
nexo.info().then((i) => {
  $('#dir').textContent = i.defaultDir;
  return i;
}).catch(() => {
  $('#dir').textContent = '—';
});
go(0);
applyLang();

const win = $('#win');
const bg = $('#bg');
win.addEventListener('pointermove', (e) => {
  const r = win.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width - 0.5;
  const y = (e.clientY - r.top) / r.height - 0.5;
  bg.style.transform = `translate(${-x * 14}px,${-y * 10}px)`;
});
win.addEventListener('pointerleave', () => {
  bg.style.transform = '';
});

/* Céu animado: pontos de luz subindo e, de vez em quando, uma estrela cadente. Desligado com "reduzir movimento". */
if (!matchMedia('(prefers-reduced-motion:reduce)').matches) {
  const c = $('#fx');
  const x = c.getContext('2d');
  let W;
  let H;
  let S = [];
  const P = [];
  let last = 0;
  let next = 900;
  const rs = () => {
    const r = c.getBoundingClientRect();
    const d = devicePixelRatio || 1;
    W = r.width * d;
    H = r.height * d;
    c.width = W;
    c.height = H;
  };
  rs();
  addEventListener('resize', rs);
  for (let i = 0; i < 34; i += 1) P.push({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.4, s: Math.random() * 6e-5 + 2e-5, p: Math.random() * 6.28 });
  const frame = (time) => {
    const dt = time - last;
    last = time;
    x.clearRect(0, 0, W, H);
    P.forEach((o) => {
      o.y -= o.s * dt;
      if (o.y < -0.02) o.y = 1.02;
      x.fillStyle = `rgba(150,210,255,${0.25 + 0.25 * Math.sin(time / 900 + o.p)})`;
      x.beginPath();
      x.arc(o.x * W, o.y * H, o.r * W / 900, 0, 6.28);
      x.fill();
    });
    if (time > next) {
      S.push({ x: W * (0.5 + Math.random() * 0.55), l: 0 });
      next = time + 1800 + Math.random() * 3200;
    }
    S = S.filter((s) => s.l < 1);
    S.forEach((s) => {
      s.l += dt / 1100;
      const k = s.l;
      const hx = s.x - k * W * 0.5;
      const hy = -20 + k * H * 0.85;
      const L = W * 0.17;
      const tx = hx + 0.55 * L;
      const ty = hy - 0.83 * L;
      const a = Math.sin(k * Math.PI);
      const g = x.createLinearGradient(hx, hy, tx, ty);
      g.addColorStop(0, `rgba(210,240,255,${a})`);
      g.addColorStop(1, 'rgba(90,150,255,0)');
      x.strokeStyle = g;
      x.lineWidth = W / 450;
      x.lineCap = 'round';
      x.beginPath();
      x.moveTo(hx, hy);
      x.lineTo(tx, ty);
      x.stroke();
      x.fillStyle = `rgba(230,248,255,${a})`;
      x.shadowColor = '#5ad7ff';
      x.shadowBlur = W / 70;
      x.beginPath();
      x.arc(hx, hy, W / 450 * 1.2, 0, 6.28);
      x.fill();
      x.shadowBlur = 0;
    });
    requestAnimationFrame(frame);
  };
  frame(0);
}
