const $ = selector => document.querySelector(selector);
const screens = [...document.querySelectorAll('.scr')];
let directory = null;
let installing = false;
let language = 'pt';
let productNotices = '';

const messages = {
  pt: {
    welcomeTitle: 'Cuide do seu PC\nsob as estrelas.',
    welcomeText: 'Diagnóstico, limpeza e monitoramento — tudo feito localmente.',
    welcomeFine: 'O compartilhamento de dados com o criador é opcional e começa desativado.',
    options: 'Opções', continue: 'Continuar', optionsTitle: 'Opções de instalação',
    destination: 'Pasta de destino', change: 'Alterar', desktopShortcut: 'Atalho na área de trabalho',
    openWhenDone: 'Abrir o Nexo ao terminar', shareCreator: 'Compartilhar dados opcionais com o criador',
    offByDefault: 'Desativado por padrão', dataDetails: 'O que o Nexo coleta neste PC?',
    projectLink: 'Projeto no GitHub', privacyLink: 'Privacidade', creatorLink: 'Perfil do criador',
    acceptNotices: 'Li e aceito os Avisos do produto', readNotices: 'Ler os Avisos',
    back: 'Voltar', install: 'Instalar', preparing: 'Preparando arquivos…',
    doneTitle: 'Tudo pronto.', doneText: 'O Nexo Device Care foi instalado com sucesso.',
    close: 'Fechar', openApp: 'Abrir o Nexo', noticesTitle: 'Avisos do produto',
    installSteps: [[0, 'Preparando arquivos…'], [25, 'Copiando o Nexo…'], [55, 'Configurando sensores…'], [80, 'Criando atalhos…'], [95, 'Finalizando…']],
    installError: 'Não foi possível instalar (código {code}).',
    privacyDetails: `COLETA LOCAL — ATIVA E RESTRITA A ESTE COMPUTADOR\n• Painel: nome do computador, versão do Windows e do Nexo, tempo ligado, uso de CPU, RAM total/livre/usada, estado de conexão (sim/não) e unidades fixas (letra, rótulo, sistema de arquivos, total/livre/usado). Endereços de rede são examinados só para calcular o estado de conexão; não são guardados nem enviados.\n• Sensores: valores oferecidos pela biblioteca para CPU, GPU, memória, placa-mãe, armazenamento, rede, bateria, fonte, medidores de energia e controladores compatíveis. Conforme o hardware: temperatura, tensão, corrente, potência, clock, frequência, carga, ventoinha, fluxo, nível, dados, transferência, duração, latência, energia, ruído, condutividade e umidade, mais mínimos e máximos da sessão. A NVIDIA também pode oferecer leituras via nvidia-smi se ele estiver instalado. Nomes de componentes/sensores podem revelar o modelo. Identificadores, números de série e endereços MAC não são lidos pelo coletor. Leituras detalhadas ficam em memória; um CSV só é criado se você pedir, com nomes/categorias de componentes e sensores, tipo, valor, unidade, mínimo, máximo e indicador de sensor avançado.\n• Diagnóstico: PID, nome e uso de CPU/memória dos cinco processos de maior consumo em cada categoria, calculados localmente.\n• Limpeza: caminho e tamanho de arquivos temporários antigos, para prévia e remoção local.\n• Histórico local: amostras de CPU, RAM, disco principal, GPU compatível e temperaturas disponíveis a cada minuto por até 7 dias; gráficos da sessão em memória por até 5 minutos.\n• Dados locais do app: feedback (categoria, útil/não útil e horário; até 100 registros); título, detalhe e horário das últimas 20 atividades; papel de parede escolhido (até 5 MB); configuração e horário da última limpeza automática.\n\nREDE: ao iniciar, o Nexo consulta as releases públicas do GitHub. O GitHub pode receber IP, horário, URL e identificação normal da solicitação. O Nexo não anexa inventário do PC. O download só começa quando você o solicita.\n\nENVIO AO CRIADOR: esta versão não envia telemetria nem relatórios de falha. A opção abaixo começa desativada e apenas grava sua preferência neste PC; ativá-la não envia dados.`,
    notices: `NEXO DEVICE CARE — AVISOS IMPORTANTES\n\nLeia estas informações antes de instalar e usar o Nexo Device Care.\n\n1. O Nexo apresenta indicadores locais e recomendações baseadas em heurísticas. Os resultados não garantem aumento de desempenho e não substituem avaliação técnica.\n\n2. A limpeza de temporários permite revisar uma prévia e remove apenas arquivos regulares antigos da pasta temporária do usuário. A limpeza automática é opcional e pode ser desativada nas configurações do aplicativo.\n\n3. A otimização de unidades e a verificação de arquivos do Windows usam ferramentas nativas do sistema. Essas operações podem solicitar permissão de administrador e devem ser confirmadas pelo usuário.\n\n4. O histórico de desempenho e as avaliações ficam armazenados localmente neste computador. O aplicativo consulta o GitHub para verificar e baixar atualizações.\n\n5. Ao continuar, você confirma que leu estes avisos e que revisará as confirmações apresentadas pelo Windows antes de autorizar operações administrativas.\n\nEste aviso descreve o funcionamento atual do aplicativo. Ele não substitui termos de licença ou documentos legais preparados para a distribuição do produto.`,
    closeLabel: 'Fechar', minimizeLabel: 'Minimizar'
  },
  en: {
    welcomeTitle: 'Care for your PC\nunder the stars.',
    welcomeText: 'Diagnostics, cleanup and monitoring — processed locally.',
    welcomeFine: 'Sharing data with the creator is optional and off by default.',
    options: 'Options', continue: 'Continue', optionsTitle: 'Installation options',
    destination: 'Install location', change: 'Change', desktopShortcut: 'Desktop shortcut',
    openWhenDone: 'Open Nexo when finished', shareCreator: 'Share optional data with the creator',
    offByDefault: 'Off by default', dataDetails: 'What does Nexo collect on this PC?',
    projectLink: 'GitHub project', privacyLink: 'Privacy policy', creatorLink: 'Creator profile',
    acceptNotices: 'I have read and accept the product notices', readNotices: 'Read the notices',
    back: 'Back', install: 'Install', preparing: 'Preparing files…',
    doneTitle: 'All set.', doneText: 'Nexo Device Care was installed successfully.',
    close: 'Close', openApp: 'Open Nexo', noticesTitle: 'Product notices',
    installSteps: [[0, 'Preparing files…'], [25, 'Copying Nexo…'], [55, 'Setting up sensors…'], [80, 'Creating shortcuts…'], [95, 'Finishing…']],
    installError: 'Installation failed (code {code}).',
    privacyDetails: `LOCAL COLLECTION — ACTIVE AND KEPT ON THIS PC\n• Dashboard: computer name, Windows and Nexo versions, uptime, CPU use, total/free/used RAM, connection status (yes/no), and fixed drives (letter, label, file system, total/free/used). Network addresses are checked only to calculate connection status; they are not stored or sent.\n• Sensors: values exposed by the library for CPU, GPU, memory, motherboard, storage, network, battery, power supply, energy meters and supported controllers. Depending on hardware: temperature, voltage, current, power, clock, frequency, load, fan, flow, level, data, throughput, duration, latency, energy, noise, conductivity and humidity, plus session minimums and maximums. NVIDIA may also provide readings through nvidia-smi if installed. Component/sensor names may reveal the model. The collector does not read hardware/sensor identifiers, serial numbers or MAC addresses. Detailed readings stay in memory; a CSV is created only when requested and contains component/sensor names and categories, type, value, unit, minimum, maximum and advanced-sensor flag.\n• Diagnostics: PID, name and CPU/memory use of the five highest-consuming processes in each category, calculated locally.\n• Cleanup: paths and sizes of old temporary files for local preview and removal.\n• Local history: CPU, RAM, main drive, supported GPU and available temperature samples every minute for up to 7 days; session charts stay in memory for up to 5 minutes.\n• Local app data: feedback (category, helpful/not helpful and time; up to 100 entries); title, details and time of the last 20 activities; chosen wallpaper (up to 5 MB); automatic-cleanup setting and last-run time.\n\nNETWORK: when launched, Nexo checks public GitHub releases. GitHub may receive the IP address, time, URL and normal request identification. Nexo does not attach a PC inventory. Downloads start only when requested.\n\nSHARING WITH THE CREATOR: this version does not send telemetry or crash reports. The option below is off by default and only stores your preference on this PC; enabling it does not send data.`,
    notices: `NEXO DEVICE CARE — IMPORTANT NOTICES\n\nRead these notices before installing and using Nexo Device Care.\n\n1. Nexo displays local indicators and heuristic recommendations. Results do not guarantee improved performance and do not replace a technical assessment.\n\n2. Temporary cleanup lets you review a preview and removes only old regular files from the user's temporary folder. Automatic cleanup is optional and can be disabled in the app settings.\n\n3. Drive optimization and Windows file checks use built-in system tools. These operations may request administrator permission and must be confirmed by the user.\n\n4. Performance history and ratings are stored locally on this computer. The app checks GitHub for updates and downloads them only when requested.\n\n5. By continuing, you confirm that you have read these notices and will review Windows confirmation prompts before authorizing administrative operations.\n\nThis notice describes the app's current behavior. It does not replace license terms or legal documents prepared for product distribution.`,
    closeLabel: 'Close', minimizeLabel: 'Minimize'
  }
};

function showScreen(index) {
  screens.forEach((screen, i) => screen.classList.toggle('on', i === index));
}

function progressLabel(percent) {
  return messages[language].installSteps.filter(([start]) => percent >= start).pop()[1];
}

function setProgress(percent) {
  $('#fill').style.width = `${percent}%`;
  $('#pct').textContent = `${percent}%`;
  $('#st').textContent = progressLabel(percent);
}

function applyLanguage(nextLanguage) {
  language = nextLanguage === 'en' ? 'en' : 'pt';
  const t = messages[language];
  document.documentElement.lang = language === 'en' ? 'en' : 'pt-BR';
  document.querySelectorAll('[data-i18n]').forEach(element => {
    const value = t[element.dataset.i18n];
    if (typeof value === 'string') element.textContent = value;
  });
  $('#min').setAttribute('aria-label', t.minimizeLabel);
  $('#x').setAttribute('aria-label', t.closeLabel);
  $('#priv').setAttribute('aria-label', t.dataDetails);
  if ($('#notices-modal').hidden === false) $('#notices-text').textContent = language === 'pt' && productNotices ? productNotices : t.notices;
}

async function startInstallation() {
  if (installing || !$('#o-terms').checked) return;
  installing = true;
  $('#err').hidden = true;
  setProgress(0);
  showScreen(2);

  const result = await nexo.install({
    dir: directory,
    desktop: $('#o-desk').checked,
    runAfter: $('#o-run').checked,
    telemetry: $('#o-tel').checked
  });

  installing = false;
  if (!result.ok) {
    $('#st').textContent = messages[language].installError.replace('{code}', result.code);
    $('#err').hidden = false;
    return;
  }

  setProgress(100);
  setTimeout(() => {
    showScreen(3);
    if ($('#o-run').checked) setTimeout(() => nexo.openApp(), 1500);
  }, 600);
}

document.querySelectorAll('[data-go]').forEach(button => {
  button.addEventListener('click', () => {
    const target = Number(button.dataset.go);
    if (target === 2) startInstallation();
    else showScreen(target);
  });
});

$('#language').addEventListener('change', event => applyLanguage(event.target.value));
$('#o-terms').addEventListener('change', event => { $('#install-button').disabled = !event.target.checked; });
$('#retry').addEventListener('click', startInstallation);
$('#open').addEventListener('click', () => nexo.openApp());
$('#close2').addEventListener('click', () => nexo.close());
$('#close3').addEventListener('click', () => nexo.close());
$('#x').addEventListener('click', () => nexo.close());
$('#min').addEventListener('click', () => nexo.minimize());
$('#pick').addEventListener('click', async () => {
  const selected = await nexo.pickDir();
  if (selected) {
    directory = selected;
    $('#dir').textContent = selected;
  }
});
$('#pl').addEventListener('click', event => {
  const expanded = $('#priv').classList.toggle('on');
  event.currentTarget.setAttribute('aria-expanded', String(expanded));
});
$('#show-notices').addEventListener('click', () => {
  $('#notices-text').textContent = language === 'pt' && productNotices ? productNotices : messages[language].notices;
  $('#notices-modal').hidden = false;
  $('#close-notices').focus();
});
$('#close-notices').addEventListener('click', () => {
  $('#notices-modal').hidden = true;
  $('#show-notices').focus();
});
$('#project-link').addEventListener('click', () => nexo.openLink('project'));
$('#privacy-link').addEventListener('click', () => nexo.openLink('privacy'));
$('#creator-link').addEventListener('click', () => nexo.openLink('creator'));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('#notices-modal').hidden) {
    $('#notices-modal').hidden = true;
    $('#show-notices').focus();
  }
});

nexo.onProgress(setProgress);
nexo.info().then(info => { $('#dir').textContent = info.defaultDir; });
nexo.notices().then(text => { productNotices = text; });
applyLanguage('pt');

const windowElement = $('#win');
const background = $('#bg');
windowElement.addEventListener('pointermove', event => {
  const rect = windowElement.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width - 0.5;
  const y = (event.clientY - rect.top) / rect.height - 0.5;
  background.style.transform = `translate(${-x * 14}px, ${-y * 10}px)`;
});
windowElement.addEventListener('pointerleave', () => { background.style.transform = ''; });

if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const canvas = $('#fx');
  const context = canvas.getContext('2d');
  let width, height, shootingStars = [], lastFrame = 0, nextStar = 900;
  const particles = [];
  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = devicePixelRatio || 1;
    width = canvas.width = rect.width * ratio;
    height = canvas.height = rect.height * ratio;
  };
  resizeCanvas();
  addEventListener('resize', resizeCanvas);
  for (let i = 0; i < 34; i++) {
    particles.push({ x: Math.random(), y: Math.random(), radius: Math.random() * 1.6 + 0.4, speed: Math.random() * 6e-5 + 2e-5, phase: Math.random() * 6.28 });
  }

  (function animate(time) {
    const delta = time - lastFrame;
    lastFrame = time;
    context.clearRect(0, 0, width, height);
    particles.forEach(particle => {
      particle.y -= particle.speed * delta;
      if (particle.y < -0.02) particle.y = 1.02;
      context.fillStyle = `rgba(150,210,255,${0.25 + 0.25 * Math.sin(time / 900 + particle.phase)})`;
      context.beginPath();
      context.arc(particle.x * width, particle.y * height, particle.radius * width / 900, 0, 6.28);
      context.fill();
    });
    if (time > nextStar) {
      shootingStars.push({ x: width * (0.5 + Math.random() * 0.55), progress: 0 });
      nextStar = time + 1800 + Math.random() * 3200;
    }
    shootingStars = shootingStars.filter(star => star.progress < 1);
    shootingStars.forEach(star => {
      star.progress += delta / 1100;
      const progress = star.progress;
      const headX = star.x - progress * width * 0.5;
      const headY = -20 + progress * height * 0.85;
      const length = width * 0.17;
      const tailX = headX + 0.55 * length;
      const tailY = headY - 0.83 * length;
      const alpha = Math.sin(progress * Math.PI);
      const gradient = context.createLinearGradient(headX, headY, tailX, tailY);
      gradient.addColorStop(0, `rgba(210,240,255,${alpha})`);
      gradient.addColorStop(1, 'rgba(90,150,255,0)');
      context.strokeStyle = gradient;
      context.lineWidth = width / 450;
      context.lineCap = 'round';
      context.beginPath();
      context.moveTo(headX, headY);
      context.lineTo(tailX, tailY);
      context.stroke();
      context.fillStyle = `rgba(230,248,255,${alpha})`;
      context.shadowColor = '#5ad7ff';
      context.shadowBlur = width / 70;
      context.beginPath();
      context.arc(headX, headY, width / 450 * 1.2, 0, 6.28);
      context.fill();
      context.shadowBlur = 0;
    });
    requestAnimationFrame(animate);
  })(0);
}
