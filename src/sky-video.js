/*
 * Fundo animado do app: o campo de flores azuis sob o céu do Nexo (dev/flower-scene), um vídeo em loop de 30 s a 30
 * quadros. Fica atrás de tudo, dentro de .sky-art (ganha a mesma paralaxe da imagem), e quem toca é o decodificador de
 * vídeo da placa. A imagem parada embaixo é o primeiro quadro do mesmo vídeo, então a troca entre os dois não "pula".
 *
 * Fica a imagem parada (sem vídeo): no modo Leve, com "reduzir movimento" do sistema, com papel de parede escolhido
 * pela pessoa, se a placa não decodifica o vídeo no próprio hardware ou se o arquivo não tocar. Pausa com a janela
 * escondida, fora de foco, com o app ocioso e enquanto o céu da Análise (que cobre o fundo) está tocando.
 */
(function () {
  const art = document.querySelector('.sky-art');
  if (!art) return;
  const BASE = window.__assetBase || '';
  const SRC = `${BASE}assets/scene/flores.mp4`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let video = null;
  let failed = false;
  let capable = null;

  const customWallpaper = () => Boolean(document.documentElement.style.getPropertyValue('--wallpaper-image'));
  const allowed = () => !failed && !Nexo.effectsLite && !reduce.matches && !customWallpaper() && capable !== false;
  const covered = () => document.getElementById('space-page')?.dataset.play === '1';
  const shouldPlay = () => allowed() && !document.hidden && document.hasFocus() && !Nexo.isIdle?.() && !covered();

  /** Só toca se o Full HD em H.264 for decodificado pela placa (powerEfficient): PC sem isso fica com a imagem. */
  async function hardware() {
    if (capable !== null) return capable;
    try {
      const info = await navigator.mediaCapabilities?.decodingInfo?.({ type: 'file', video: { contentType: 'video/mp4; codecs="avc1.640029"', width: 1920, height: 1080, bitrate: 8000000, framerate: 30 } });
      capable = info ? Boolean(info.supported && info.powerEfficient) : true;
    } catch { capable = true; }
    return capable;
  }

  function create() {
    video = document.createElement('video');
    video.className = 'sky-video';
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.disableRemotePlayback = true;
    video.setAttribute('aria-hidden', 'true');
    video.tabIndex = -1;
    video.addEventListener('playing', () => { art.dataset.video = 'on'; });
    // Sem o arquivo ou sem decodificador: fica a imagem parada nesta sessão.
    video.addEventListener('error', () => { failed = true; remove(); });
    video.src = SRC;
    art.appendChild(video);
  }
  function remove() {
    if (!video) return;
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    video = null;
    delete art.dataset.video;
  }

  async function update() {
    if (!allowed()) { remove(); return; }
    if (!(await hardware())) { remove(); return; }
    if (!video) create();
    if (shouldPlay()) { const attempt = video.play(); if (attempt?.catch) attempt.catch(() => {}); }
    else video.pause();
  }

  Nexo.skyVideo = { refresh: update, playing: () => Boolean(video && !video.paused) };
  for (const event of ['effects', 'view', 'wallpaper', 'idle']) Nexo.on?.(event, () => update());
  document.addEventListener('visibilitychange', update);
  addEventListener('focus', update);
  addEventListener('blur', update);
  reduce.addEventListener?.('change', update);
  // O céu da Análise liga e desliga o próprio vídeo: acompanha pelo atributo dele.
  const page = document.getElementById('space-page');
  if (page && typeof MutationObserver === 'function') new MutationObserver(update).observe(page, { attributes: true, attributeFilter: ['data-play'] });
  update();
})();
