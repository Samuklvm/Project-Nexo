/*
 * Diagnóstico de rede: "a internet está boa, mas os sites demoram para abrir".
 *
 * O que mede (só leitura, alguns segundos):
 *  - DNS: quanto o servidor de DNS que o PC usa demora para responder (nomes conhecidos e um nome novo, que não está
 *    em cache nenhum), comparado com o DNS da Cloudflare (1.1.1.1) e do Google (8.8.8.8);
 *  - o caminho completo do sistema (getaddrinfo: cache, arquivo hosts, DNS);
 *  - conexão direta (TCP) por IPv4 e, se o PC tem endereço IPv6 público, por IPv6: IPv6 "meio quebrado" faz cada site
 *    tentar primeiro o caminho que não funciona;
 *  - proxy: o configurado responde? Quanto demora a procura automática de proxy (WPAD)?
 *  - o caminho de um site de verdade (DNS, conexão, criptografia e primeira resposta);
 *  - a velocidade em que o cabo ou o Wi-Fi conectou (cabo bom em porta de 100 Mbps é um clássico).
 *
 * Nada aqui muda o PC: as correções ficam em main.cjs/elevate.cjs, com confirmação e registro no Diário.
 */
const NAMES = ['www.google.com', 'www.youtube.com', 'www.wikipedia.org', 'www.microsoft.com', 'www.cloudflare.com', 'www.amazon.com'];
const PUBLIC = Object.freeze({
  cloudflare: { label: 'Cloudflare', v4: ['1.1.1.1', '1.0.0.1'], v6: ['2606:4700:4700::1111', '2606:4700:4700::1001'] },
  google: { label: 'Google', v4: ['8.8.8.8', '8.8.4.4'], v6: ['2001:4860:4860::8888', '2001:4860:4860::8844'] }
});
const HTTP_PROBES = ['https://www.google.com/generate_204', 'https://cp.cloudflare.com/generate_204'];

const median = (list) => { const v = list.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const m = Math.floor(v.length / 2); return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
const round = (value) => (Number.isFinite(value) ? Math.round(value) : null);

/** Windows: adaptador da rota padrão, DNS (de DHCP ou fixo), proxy do usuário e a preferência de IPv6. */
const WINDOWS_INFO = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
$idx = if ($route) { [int]$route.ifIndex } else { 0 }
$a = if ($idx) { Get-NetAdapter -InterfaceIndex $idx } else { $null }
$v4 = @(); $v6 = @(); $static4 = @(); $static6 = @()
if ($idx) {
  $v4 = @((Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv4).ServerAddresses)
  $v6 = @((Get-DnsClientServerAddress -InterfaceIndex $idx -AddressFamily IPv6).ServerAddresses)
  if ($a) {
    $g = $a.InterfaceGuid
    $s4 = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\$g" -Name NameServer).NameServer
    $s6 = (Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters\Interfaces\$g" -Name NameServer).NameServer
    if ($s4) { $static4 = @($s4 -split '[ ,]+' | Where-Object { $_ }) }
    if ($s6) { $static6 = @($s6 -split '[ ,]+' | Where-Object { $_ }) }
  }
}
$is = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$p = Get-ItemProperty -LiteralPath $is
$conn = (Get-ItemProperty -LiteralPath "$is\Connections" -Name DefaultConnectionSettings).DefaultConnectionSettings
$auto = $null; if ($conn -and $conn.Length -gt 8) { $auto = [bool]($conn[8] -band 8) }
$dc = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\Tcpip6\Parameters' -Name DisabledComponents).DisabledComponents
[pscustomobject]@{
  ifIndex = $idx
  adapter = if ($a) { [pscustomobject]@{ name = [string]$a.Name; description = [string]$a.InterfaceDescription; linkSpeed = [string]$a.LinkSpeed; media = [string]$a.PhysicalMediaType; bps = [long]$a.ReceiveLinkSpeed } } else { $null }
  dnsV4 = @($v4 | ForEach-Object { [string]$_ }); dnsV6 = @($v6 | ForEach-Object { [string]$_ })
  staticV4 = @($static4); staticV6 = @($static6)
  proxyEnable = [int]$p.ProxyEnable; proxyServer = [string]$p.ProxyServer; autoConfigUrl = [string]$p.AutoConfigURL; autoDetect = $auto
  disabledComponents = if ($null -ne $dc) { [int]$dc } else { $null }
} | ConvertTo-Json -Compress -Depth 4`;

function createNetDoctor({ dns, net, https, os, fs, platform = process.platform, runPowerShell, resolveProxy, randomBytes = require('node:crypto').randomBytes, now = () => performance.now() }) {
  const timed = async (work, timeoutMs) => {
    const start = now();
    let timer;
    try {
      await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); })]);
      return { ms: round(now() - start), ok: true };
    } catch (error) { return { ms: round(now() - start), ok: false, error: String(error?.code || error?.message || error).slice(0, 40) }; }
    finally { clearTimeout(timer); }
  };

  /** Um servidor de DNS: os nomes conhecidos (um de cada vez) e dois nomes novos (sem cache em lugar nenhum). */
  async function dnsServer(server) {
    const resolver = new dns.promises.Resolver({ timeout: 2500, tries: 1 });
    resolver.setServers([server]);
    const known = [];
    for (const name of NAMES) known.push(await timed(() => resolver.resolve4(name), 3000));
    const fresh = [];
    for (let i = 0; i < 2; i += 1) {
      const name = `nexo-${randomBytes(6).toString('hex')}.wikipedia.org`;
      // Nome inexistente: a resposta "não existe" também mede a ida até o DNS da internet.
      fresh.push(await timed(() => resolver.resolve4(name).catch((error) => { if (error?.code === 'ENOTFOUND' || error?.code === 'ENODATA') return null; throw error; }), 3000));
    }
    const okKnown = known.filter((r) => r.ok);
    return { server, medianMs: round(median(okKnown.map((r) => r.ms))), worstMs: okKnown.length ? Math.max(...okKnown.map((r) => r.ms)) : null, failures: known.length - okKnown.length, tries: known.length,
      freshMs: round(median(fresh.filter((r) => r.ok).map((r) => r.ms))), freshFailures: fresh.filter((r) => !r.ok).length };
  }

  const tcp = (host, port, timeoutMs = 2500) => timed(() => new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', (error) => { socket.destroy(); reject(error); });
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error('timeout')); });
  }), timeoutMs + 200);

  async function tcpMedian(host, port) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await tcp(host, port));
    const ok = runs.filter((r) => r.ok);
    return { host, ok: ok.length > 0, ms: round(median(ok.map((r) => r.ms))), failures: runs.length - ok.length };
  }

  /** Um site de verdade, com as fases: DNS, conexão, criptografia (TLS) e primeira resposta. */
  function httpProbe(url) {
    return new Promise((resolve) => {
      const start = now();
      const out = { url, ok: false };
      const finish = (extra = {}) => { if (out.done) return; out.done = true; delete out.done; resolve({ ...out, ...extra, totalMs: round(now() - start) }); };
      let request;
      try {
        request = https.get(url, { agent: false, timeout: 8000, headers: { 'user-agent': 'NexoDeviceCare-diagnostico' } }, (response) => {
          out.firstByteMs = round(now() - start);
          out.status = response.statusCode;
          out.ok = response.statusCode < 500;
          response.resume();
          response.on('end', () => finish());
        });
      } catch (error) { finish({ error: String(error?.code || error?.message).slice(0, 40) }); return; }
      request.on('socket', (socket) => {
        socket.on('lookup', () => { out.dnsMs = round(now() - start); });
        socket.on('connect', () => { out.connectMs = round(now() - start); out.family = socket.remoteFamily || null; });
        socket.on('secureConnect', () => { out.tlsMs = round(now() - start); });
      });
      request.on('timeout', () => { request.destroy(new Error('timeout')); });
      request.on('error', (error) => finish({ error: String(error?.code || error?.message).slice(0, 40) }));
    });
  }

  /** Informação do sistema (Windows pelo PowerShell; Linux pelos arquivos do sistema). */
  async function systemInfo() {
    if (platform === 'win32') {
      try { const result = await runPowerShell(WINDOWS_INFO, 30000); return JSON.parse(String(result.stdout || '').trim() || '{}'); } catch { return {}; }
    }
    const info = { dnsV4: [], dnsV6: [], staticV4: [], staticV6: [], adapter: null };
    try {
      const resolv = await fs.readFile('/etc/resolv.conf', 'utf8');
      for (const line of resolv.split('\n')) { const m = /^\s*nameserver\s+(\S+)/.exec(line); if (m) (net.isIPv6(m[1]) ? info.dnsV6 : info.dnsV4).push(m[1]); }
    } catch { /* sem resolv.conf */ }
    try {
      const route = await fs.readFile('/proc/net/route', 'utf8');
      const dev = route.split('\n').slice(1).map((line) => line.trim().split(/\s+/)).find((cols) => cols[1] === '00000000')?.[0];
      if (dev) {
        const speed = Number(String(await fs.readFile(`/sys/class/net/${dev}/speed`, 'utf8').catch(() => '')).trim());
        const wireless = await fs.stat(`/sys/class/net/${dev}/wireless`).then(() => true).catch(() => false);
        info.adapter = { name: dev, description: dev, linkSpeed: speed > 0 ? `${speed >= 1000 ? speed / 1000 : speed} ${speed >= 1000 ? 'Gbps' : 'Mbps'}` : '', media: wireless ? 'Native 802.11' : '802.3', bps: speed > 0 ? speed * 1e6 : 0 };
      }
    } catch { /* sem rota */ }
    const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || '';
    info.proxyEnable = proxy ? 1 : 0;
    info.proxyServer = proxy.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return info;
  }

  const hasPublicIpv6 = () => Object.values(os.networkInterfaces()).flat().some((item) => item && !item.internal && (item.family === 'IPv6' || item.family === 6) && !/^(fe80|fc|fd|::1)/i.test(item.address));

  async function measure() {
    const info = await systemInfo();
    const systemServers = [...new Set([...(info.dnsV4 || []), ...(dns.getServers?.() || [])].filter((ip) => net.isIPv4(ip)))].slice(0, 2);
    const results = { info, platform };
    results.dnsSystem = [];
    for (const server of systemServers) results.dnsSystem.push(await dnsServer(server));
    results.dnsPublic = { cloudflare: await dnsServer(PUBLIC.cloudflare.v4[0]), google: await dnsServer(PUBLIC.google.v4[0]) };
    results.lookup = await timed(() => dns.promises.lookup('www.wikipedia.org'), 6000);
    results.ipv4 = await tcpMedian(PUBLIC.cloudflare.v4[0], 443);
    results.hasIpv6 = hasPublicIpv6();
    results.ipv6 = results.hasIpv6 ? await tcpMedian(PUBLIC.cloudflare.v6[0], 443) : null;
    if (info.proxyEnable && info.proxyServer) {
      const target = String(info.proxyServer).split(';').map((part) => part.replace(/^\w+=/, '')).find(Boolean) || '';
      const m = /^\[?([^\]]+?)\]?:(\d{1,5})$/.exec(target);
      results.proxy = m ? { server: target, ...(await tcp(m[1], Number(m[2]))) } : { server: target, ok: false, error: 'formato' };
    }
    if (resolveProxy) {
      const start = now();
      let answer = null;
      try { answer = await Promise.race([resolveProxy('https://www.google.com/'), new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 12000))]); } catch { answer = null; }
      results.proxyLookup = { ms: round(now() - start), result: String(answer || '').slice(0, 80) };
    }
    results.http = [];
    for (const url of HTTP_PROBES) results.http.push(await httpProbe(url));
    return results;
  }

  return { measure, systemInfo, analyze, PUBLIC };
}

/**
 * Transforma as medidas em verificações (ok, aviso, problema) e correções sugeridas. Puro, para testar sem rede.
 * Cada correção tem um id fixo que o processo principal sabe executar.
 */
function analyze(m) {
  const checks = [];
  const fixes = new Map();
  const add = (check) => checks.push(check);
  const ms = (value) => (Number.isFinite(value) ? `${value} ms` : 'sem resposta');
  const win = m.platform === 'win32';

  // DNS: o do PC contra o melhor público.
  const sys = (m.dnsSystem || []).filter(Boolean);
  const sysBest = sys.slice().sort((a, b) => (a.medianMs ?? 1e9) - (b.medianMs ?? 1e9))[0] || null;
  const pubs = Object.entries(m.dnsPublic || {}).map(([id, r]) => ({ id, ...r }));
  const pubBest = pubs.filter((p) => Number.isFinite(p.medianMs)).sort((a, b) => a.medianMs - b.medianMs)[0] || null;
  const sysMs = sysBest?.medianMs;
  const sysFails = sys.length ? Math.min(...sys.map((r) => r.failures)) : 0;
  const sysFresh = sysBest?.freshMs;
  const pubFresh = pubBest?.freshMs;
  if (!sys.length) {
    add({ id: 'dns', level: 'aviso', title: 'DNS do PC', detail: 'Não deu para descobrir qual DNS este PC usa.' });
  } else {
    const slow = (sysFails >= 2) || (Number.isFinite(sysMs) && sysMs > 150) || (Number.isFinite(sysFresh) && sysFresh > 450) || (!Number.isFinite(sysMs));
    const publicHelps = pubBest && Number.isFinite(pubBest.medianMs) && (!Number.isFinite(sysMs) || (pubBest.medianMs * 2 < sysMs && sysMs - pubBest.medianMs > 60) || sysFails >= 2 || (Number.isFinite(sysFresh) && Number.isFinite(pubFresh) && sysFresh > 450 && pubFresh * 2 < sysFresh));
    const detail = `O DNS deste PC (${sysBest.server}) respondeu em ${ms(sysMs)}${sysFails ? `, com ${sysFails} de ${sysBest.tries} sem resposta` : ''}; um nome novo levou ${ms(sysFresh)}. ${pubBest ? `O DNS ${pubBest.id === 'cloudflare' ? 'da Cloudflare' : 'do Google'} respondeu em ${ms(pubBest.medianMs)} (nome novo: ${ms(pubFresh)}).` : ''}`;
    if (slow && publicHelps) {
      add({ id: 'dns', level: 'problema', title: 'O DNS da sua rede está lento', detail: `${detail} Cada site novo espera essa resposta antes de começar a abrir: é o motivo mais comum de "internet boa, sites demorando".`, fix: 'dns-publico' });
      fixes.set('dns-publico', { id: 'dns-publico', provider: pubBest.id, label: `Usar o DNS ${pubBest.id === 'cloudflare' ? 'da Cloudflare' : 'do Google'}`, windowsOnly: true, admin: true, reversible: true });
    } else if (slow) {
      add({ id: 'dns', level: 'aviso', title: 'DNS lento, mas a rede toda está lenta', detail: `${detail} Os DNS públicos também demoraram, então o problema parece estar antes: Wi-Fi, roteador ou a operadora.` });
    } else {
      add({ id: 'dns', level: 'ok', title: 'DNS respondendo bem', detail });
    }
  }

  // Caminho completo do sistema (cache, hosts, DNS).
  if (m.lookup) {
    if (!m.lookup.ok) add({ id: 'lookup', level: 'problema', title: 'O Windows não conseguiu resolver um site conhecido', detail: `A consulta pelo sistema falhou (${m.lookup.error || 'erro'}) em ${ms(m.lookup.ms)}.`, fix: 'limpar-dns' });
    else if (m.lookup.ms > 800) add({ id: 'lookup', level: 'aviso', title: 'A consulta de nomes do sistema está lenta', detail: `Levou ${ms(m.lookup.ms)} para achar www.wikipedia.org pelo caminho do sistema. Limpar o cache de DNS costuma resolver quando o cache está ruim.`, fix: 'limpar-dns' });
    else add({ id: 'lookup', level: 'ok', title: 'Consulta de nomes do sistema', detail: `${ms(m.lookup.ms)} para achar um site conhecido.` });
  }

  // IPv4 e IPv6.
  if (m.ipv4) {
    if (!m.ipv4.ok) add({ id: 'ipv4', level: 'problema', title: 'Sem conexão direta pela internet (IPv4)', detail: 'Não deu para conectar a 1.1.1.1 na porta 443. Confira o cabo, o roteador ou um firewall/antivírus bloqueando.' });
    else add({ id: 'ipv4', level: m.ipv4.ms > 120 ? 'aviso' : 'ok', title: 'Conexão pela internet (IPv4)', detail: `${ms(m.ipv4.ms)} até a Cloudflare.${m.ipv4.ms > 120 ? ' Alto para cabo: pode ser Wi-Fi, roteador ou a operadora.' : ''}` });
  }
  if (m.hasIpv6 && m.ipv6) {
    if (!m.ipv6.ok && m.ipv4?.ok) {
      add({ id: 'ipv6', level: 'problema', title: 'IPv6 configurado, mas sem funcionar', detail: 'O PC tem endereço IPv6 da operadora, mas nenhuma conexão por IPv6 completou. Programas tentam o IPv6 primeiro e esperam antes de cair para o IPv4: isso atrasa a abertura de sites.', fix: 'preferir-ipv4' });
      fixes.set('preferir-ipv4', { id: 'preferir-ipv4', label: 'Preferir IPv4', windowsOnly: true, admin: true, reversible: true, restart: true });
    } else if (m.ipv6.ok) add({ id: 'ipv6', level: 'ok', title: 'IPv6 funcionando', detail: `${ms(m.ipv6.ms)} até a Cloudflare por IPv6.` });
  } else if (m.hasIpv6 === false) add({ id: 'ipv6', level: 'ok', title: 'IPv6', detail: 'Este PC não tem IPv6 público; tudo vai por IPv4 (normal).' });

  // Proxy.
  const info = m.info || {};
  if (m.proxy) {
    if (!m.proxy.ok) {
      add({ id: 'proxy', level: 'problema', title: 'Proxy configurado não responde', detail: `O Windows manda a internet pelo proxy ${m.proxy.server}, que não respondeu. Se você não usa proxy de propósito (empresa, escola), desligue.`, fix: 'desligar-proxy' });
      fixes.set('desligar-proxy', { id: 'desligar-proxy', label: 'Desligar o proxy', windowsOnly: true, admin: false, reversible: true });
    } else add({ id: 'proxy', level: 'aviso', title: 'A internet passa por um proxy', detail: `Proxy ${m.proxy.server} respondeu em ${ms(m.proxy.ms)}. Se você não sabe por que ele está aí, vale conferir em Configurações > Rede > Proxy.`, fix: 'abrir-proxy' });
  }
  if (m.proxyLookup) {
    const auto = info.autoDetect === true || Boolean(info.autoConfigUrl);
    if (m.proxyLookup.ms > 1500 && auto) {
      add({ id: 'wpad', level: 'problema', title: 'A procura automática de proxy demora', detail: `O Windows levou ${(m.proxyLookup.ms / 1000).toFixed(1).replace('.', ',')} s procurando um proxy na rede ("Detectar configurações automaticamente"). Em casa quase nunca existe um, e essa espera pode se repetir em cada programa.`, fix: info.autoDetect === true && !info.autoConfigUrl ? 'desligar-autodetect' : 'abrir-proxy' });
      if (info.autoDetect === true && !info.autoConfigUrl) fixes.set('desligar-autodetect', { id: 'desligar-autodetect', label: 'Desligar a detecção automática de proxy', windowsOnly: true, admin: false, reversible: true });
    } else add({ id: 'wpad', level: 'ok', title: 'Configuração de proxy', detail: `${/DIRECT/i.test(m.proxyLookup.result) ? 'Conexão direta, sem proxy' : `Proxy: ${m.proxyLookup.result}`} (${ms(m.proxyLookup.ms)} para decidir).` });
  }
  if ([...checks].some((c) => c.fix === 'abrir-proxy')) fixes.set('abrir-proxy', { id: 'abrir-proxy', label: 'Abrir as configurações de proxy', windowsOnly: true, admin: false, reversible: false });

  // Site de verdade.
  const okProbes = (m.http || []).filter((p) => p.ok);
  if ((m.http || []).length) {
    if (!okProbes.length) add({ id: 'http', level: 'problema', title: 'Os sites de teste não abriram', detail: `Nenhum dos testes completou (${(m.http || []).map((p) => p.error || p.status).filter(Boolean).join(', ') || 'sem resposta'}). Pode ser firewall, antivírus ou proxy.` });
    else {
      const best = okProbes.slice().sort((a, b) => a.totalMs - b.totalMs)[0];
      const tls = Number.isFinite(best.tlsMs) && Number.isFinite(best.connectMs) ? best.tlsMs - best.connectMs : null;
      const level = best.firstByteMs > 1500 ? 'problema' : best.firstByteMs > 700 ? 'aviso' : 'ok';
      const parts = [`nome ${ms(best.dnsMs)}`, `conexão ${ms(Number.isFinite(best.connectMs) && Number.isFinite(best.dnsMs) ? best.connectMs - best.dnsMs : best.connectMs)}`, `criptografia ${ms(tls)}`, `primeira resposta em ${ms(best.firstByteMs)}`];
      const slowTls = Number.isFinite(tls) && tls > 600 && Number.isFinite(m.ipv4?.ms) && m.ipv4.ms < 150;
      add({ id: 'http', level: slowTls && level === 'ok' ? 'aviso' : level, title: level === 'ok' ? 'Abrindo um site de verdade' : 'Um site de verdade demorou', detail: `${new URL(best.url).hostname}: ${parts.join(', ')}.${slowTls ? ' A criptografia demorou bem mais que a conexão: antivírus que inspeciona HTTPS costuma causar isso.' : ''}` });
    }
  }

  // Velocidade do link.
  const adapter = info.adapter;
  if (adapter) {
    const wired = /802\.3/.test(String(adapter.media)) && !/802\.11|wireless|wi-?fi/i.test(`${adapter.media} ${adapter.description}`);
    const mbps = Number(adapter.bps) ? Number(adapter.bps) / 1e6 : null;
    if (wired && Number.isFinite(mbps) && mbps > 0 && mbps <= 100) add({ id: 'link', level: 'aviso', title: `O cabo conectou a ${adapter.linkSpeed || `${mbps} Mbps`}`, detail: `${adapter.description}: um cabo bom numa porta gigabit deveria conectar a 1 Gbps ou mais. Experimente outra porta do roteador, confira se o conector está bem encaixado e se o driver da placa de rede está atualizado.` });
    else add({ id: 'link', level: 'ok', title: wired ? 'Cabo de rede' : 'Wi-Fi', detail: `${adapter.description}${adapter.linkSpeed ? `, conectado a ${adapter.linkSpeed}` : ''}.` });
  }

  // Sempre à mão: limpar o cache de DNS; e, só no Windows, o reparo profundo como último recurso.
  fixes.set('limpar-dns', { id: 'limpar-dns', label: 'Limpar o cache de DNS', windowsOnly: false, admin: false, reversible: false });
  if (win) fixes.set('reparo-profundo', { id: 'reparo-profundo', label: 'Reparo profundo da rede', windowsOnly: true, admin: true, reversible: false, restart: true, lastResort: true });

  const problems = checks.filter((c) => c.level === 'problema').length;
  const warnings = checks.filter((c) => c.level === 'aviso').length;
  const usable = [...fixes.values()].filter((fix) => win || !fix.windowsOnly);
  return { checks, fixes: usable, problems, warnings, summary: problems ? `${problems === 1 ? 'Achamos 1 problema' : `Achamos ${problems} problemas`}${warnings ? ` e ${warnings} ${warnings === 1 ? 'aviso' : 'avisos'}` : ''}.` : warnings ? `Nada grave; ${warnings === 1 ? '1 ponto' : `${warnings} pontos`} para olhar.` : 'Tudo certo com a rede deste PC.' };
}

module.exports = { createNetDoctor, analyze, PUBLIC, NAMES, WINDOWS_INFO };
