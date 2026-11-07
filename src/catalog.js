/*
 * Catálogo de técnicas do Nexo.
 * Regra do projeto: nenhuma operação existe sem origem, mecanismo, compatibilidade, risco, forma de medir e reversão.
 * `estado` é honesto: "validado em dev" = testes automatizados; "aguarda Windows real" = ainda não rodou numa máquina de verdade.
 * `evidencia`: oficial (documentação do fornecedor) | observada (visto no comportamento do Windows, sem documento oficial citado) | hipotese.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoCatalog = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const RISK = { informativo: 0, baixo: 1, moderado: 2, alto: 3, critico: 4 };
  const RISK_LABEL = { informativo: 'Informativo', baixo: 'Risco baixo', moderado: 'Risco moderado', alto: 'Risco alto', critico: 'Risco crítico' };
  const REQUIRED = ['id', 'titulo', 'categoria', 'mecanismo', 'oQueAltera', 'porQuePodeAjudar', 'quandoNaoAjuda', 'oQuePodeMudar', 'risco', 'reversivel', 'reversao', 'persistente', 'exigeReinicio', 'exigeAdmin', 'compat', 'fontes', 'medicao', 'estado'];

  const MS = (titulo, url, evidencia = 'oficial') => ({ titulo, url, evidencia });

  const entries = [
    {
      id: 'power-plan-switch', titulo: 'Trocar o plano de energia', categoria: 'energia',
      mecanismo: 'powercfg /setactive <GUID>. O GUID é lido do próprio Windows (CIM Win32_PowerPlan) e a troca só é aceita se o plano estiver nessa lista.',
      oQueAltera: 'Define qual plano de energia o Windows usa. Isso muda limites de frequência do processador, tempo para suspender e comportamento de núcleos ociosos.',
      porQuePodeAjudar: 'Planos de economia limitam a frequência máxima e demoram a acelerar; trocar para um plano de desempenho pode aumentar a velocidade percebida em cargas intensas.',
      quandoNaoAjuda: 'Em notebooks na bateria, em PCs já limitados por temperatura, ou quando o gargalo é GPU, disco ou rede. Em muitos PCs a diferença fica dentro do ruído de medição.',
      oQuePodeMudar: 'Mais consumo de energia e calor; menor autonomia de bateria. A troca é uma configuração do Windows e continua valendo depois de fechar o Nexo.',
      risco: 'baixo', reversivel: true, reversao: 'Voltar ao plano anterior, que o Nexo guarda no Diário de alterações. Se o plano mudar por outro motivo depois, o Nexo avisa do conflito antes de reverter.',
      persistente: true, exigeReinicio: false, exigeAdmin: 'a validar',
      compat: { windows: 'Windows 10 e 11 (a validar em máquina real)', hardware: 'Qualquer; o efeito depende de CPU e firmware' },
      fontes: [MS('Powercfg command-line options (Microsoft Learn)', 'https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options')],
      medicao: 'Experimento A/B: benchmark curto de CPU (um núcleo e vários núcleos), 3 repetições por plano, comparando a mediana com o ruído medido.',
      estado: 'Lógica validada em dev (testes). Aguarda validação em Windows real; documentação antiga cita administrador para o powercfg.'
    },
    {
      id: 'cleanup-temp', titulo: 'Limpar temporários antigos', categoria: 'limpeza',
      mecanismo: 'Lista arquivos regulares com mais de 7 dias diretamente na pasta temporária do usuário (sem subpastas, ignorando links) e remove com unlink após prévia e confirmação.',
      oQueAltera: 'Apaga arquivos temporários antigos. Não toca em subpastas, pois programas em execução podem usar arquivos antigos dentro delas.',
      porQuePodeAjudar: 'Libera espaço no disco principal, o que ajuda quando ele está muito cheio.',
      quandoNaoAjuda: 'Quando o disco já tem bastante espaço livre: liberar espaço não acelera o computador por si só.',
      oQuePodeMudar: 'Um programa pode precisar recriar um arquivo que ele guardou como cache.',
      risco: 'baixo', reversivel: false, reversao: 'Não há reversão: os arquivos são removidos sem passar pela Lixeira. Por isso há prévia, filtro de idade, limite de 5.000 arquivos por execução e confirmação.',
      persistente: true, exigeReinicio: false, exigeAdmin: false,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Observação do comportamento do Windows: %TEMP% guarda arquivos de programas (sem documento oficial citado)', null, 'observada')],
      medicao: 'Bytes e quantidade de arquivos removidos, conferidos antes e depois pelo próprio Nexo.',
      estado: 'Testado em dev com arquivos sintéticos (idade, links, limites). Aguarda validação em Windows real.'
    },
    {
      id: 'cleanup-crashdumps', titulo: 'Limpar relatórios de falha (CrashDumps)', categoria: 'limpeza',
      mecanismo: 'Remove arquivos com mais de 7 dias em %LOCALAPPDATA%\\CrashDumps, recursivamente (até 4 níveis), e apaga pastas que ficaram vazias.',
      oQueAltera: 'Apaga despejos de memória (.dmp) de programas que travaram.',
      porQuePodeAjudar: 'Despejos podem ocupar centenas de MB. A pasta só existe se o Windows foi configurado para guardá-los.',
      quandoNaoAjuda: 'Se a pasta não existe ou está vazia. Se você pretende enviar o despejo a um desenvolvedor, não limpe.',
      oQuePodeMudar: 'Perde a chance de analisar uma falha antiga.',
      risco: 'baixo', reversivel: false, reversao: 'Não há reversão. Só arquivos com mais de 7 dias entram na prévia.',
      persistente: true, exigeReinicio: false, exigeAdmin: false,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Collecting User-Mode Dumps (Microsoft Learn)', 'https://learn.microsoft.com/windows/win32/wer/collecting-user-mode-dumps')],
      medicao: 'Bytes e quantidade removidos.',
      estado: 'Testado em dev. A documentação oficial informa que o recurso não vem ativado por padrão, então a pasta costuma não existir.'
    },
    {
      id: 'cleanup-wer', titulo: 'Limpar relatórios de erro do Windows', categoria: 'limpeza',
      mecanismo: 'Remove arquivos com mais de 7 dias em %LOCALAPPDATA%\\Microsoft\\Windows\\WER\\ReportArchive e ReportQueue.',
      oQueAltera: 'Apaga relatórios antigos do Relatório de Erros do Windows, enviados ou pendentes.',
      porQuePodeAjudar: 'Libera espaço ocupado por relatórios que não têm mais utilidade prática.',
      quandoNaoAjuda: 'Quando as pastas estão vazias, o que é comum.',
      oQuePodeMudar: 'Relatórios pendentes antigos deixam de existir.',
      risco: 'baixo', reversivel: false, reversao: 'Não há reversão.',
      persistente: true, exigeReinicio: false, exigeAdmin: false,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Windows Error Reporting (visão geral, Microsoft Learn)', 'https://learn.microsoft.com/windows/win32/wer/windows-error-reporting'), MS('Caminhos das pastas ReportArchive/ReportQueue: observados no Windows, sem página oficial citada', null, 'observada')],
      medicao: 'Bytes e quantidade removidos.',
      estado: 'Testado em dev. Os caminhos precisam ser confirmados em máquinas reais.'
    },
    {
      id: 'cleanup-recycle', titulo: 'Esvaziar a Lixeira', categoria: 'limpeza',
      mecanismo: 'Clear-RecycleBin -Force (PowerShell), que esvazia a Lixeira do usuário atual em todas as unidades. O tamanho exibido vem do Shell.Application.',
      oQueAltera: 'Apaga definitivamente tudo o que está na Lixeira do usuário atual.',
      porQuePodeAjudar: 'Libera o espaço de arquivos que já foram excluídos.',
      quandoNaoAjuda: 'Quando a Lixeira está vazia ou o espaço em disco não é um problema.',
      oQuePodeMudar: 'Você não poderá mais restaurar nada que estava na Lixeira.',
      risco: 'moderado', reversivel: false, reversao: 'Não há reversão. Por isso a opção vem desmarcada e marcada como definitiva.',
      persistente: true, exigeReinicio: false, exigeAdmin: false,
      compat: { windows: 'Windows 10 e 11 (PowerShell 5.1)', hardware: 'Qualquer' },
      fontes: [MS('Clear-RecycleBin (Microsoft Learn)', 'https://learn.microsoft.com/powershell/module/microsoft.powershell.management/clear-recyclebin')],
      medicao: 'Itens e bytes na Lixeira antes e depois.',
      estado: 'Aguarda validação em Windows real (usa COM e PowerShell).'
    },
    {
      id: 'drive-optimize', titulo: 'Otimizar uma unidade', categoria: 'manutencao',
      mecanismo: 'Optimize-Volume (PowerShell) sem parâmetros: o Windows escolhe a operação pelo tipo de unidade (HDD: analisar e desfragmentar; SSD com TRIM: retrim).',
      oQueAltera: 'Reorganiza arquivos em HD ou reenvia comandos TRIM a SSD.',
      porQuePodeAjudar: 'Em HD fragmentado, reduz o tempo de acesso. Em SSD, mantém o TRIM em dia.',
      quandoNaoAjuda: 'Em SSD saudável o ganho costuma ser pequeno ou nulo; o Windows já faz isso sozinho em manutenção agendada.',
      oQuePodeMudar: 'Uso intenso de disco durante a operação; no SSD, nenhuma mudança visível.',
      risco: 'baixo', reversivel: false, reversao: 'Não há estado a desfazer: é uma operação de manutenção nativa do Windows.',
      persistente: false, exigeReinicio: false, exigeAdmin: 'a validar',
      compat: { windows: 'Windows 10 e 11', hardware: 'Unidades locais com letra' },
      fontes: [MS('Optimize-Volume (Microsoft Learn)', 'https://learn.microsoft.com/powershell/module/storage/optimize-volume')],
      medicao: 'Resultado informado pelo Windows. O Nexo não mede ganho de desempenho nesta operação.',
      estado: 'Aguarda validação em Windows real.'
    },
    {
      id: 'sfc-scan', titulo: 'Verificar arquivos do sistema (SFC)', categoria: 'manutencao',
      mecanismo: 'sfc /scannow, executado pelo Windows. Verifica os arquivos protegidos e substitui os corrompidos por uma cópia em cache.',
      oQueAltera: 'Pode substituir arquivos de sistema corrompidos por cópias válidas.',
      porQuePodeAjudar: 'Corrige falhas causadas por arquivos de sistema danificados.',
      quandoNaoAjuda: 'Se o sistema não tem arquivos corrompidos (o resultado mais comum) ou se o problema é de hardware ou driver.',
      oQuePodeMudar: 'Pode levar vários minutos e usar bastante o disco.',
      risco: 'baixo', reversivel: 'parcial', reversao: 'O Nexo não oferece reversão. O próprio Windows registra detalhes em CBS.log; a Microsoft recomenda rodar o DISM antes, se houver erros.',
      persistente: true, exigeReinicio: false, exigeAdmin: true,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Use the System File Checker tool to repair missing or corrupted system files (Microsoft Support)', 'https://support.microsoft.com/kb/929833')],
      medicao: 'Mensagem de resultado do Windows. Nenhum ganho de desempenho é prometido.',
      estado: 'Aguarda validação em Windows real.'
    },
    {
      id: 'lab-session', titulo: 'Otimização extrema (beta): sessão de risco do laboratório', categoria: 'laboratorio',
      mecanismo: 'Clona o plano de energia ativo (powercfg /duplicatescheme) para "Nexo Lab (temporário)", ativa o clone e testa, um de cada vez, valores de um espaço fechado de 71 configurações de energia (processador, estacionamento de núcleos, estados ociosos, núcleos híbridos, temperatura, SATA/NVMe, PCI Express e Wi-Fi; /setacvalueindex só na tomada e só no que o próprio PC aceita). Cada ideia passa por medição A/B intercalada em ordem ABBA, com o processador sossegado, nos testes que medem aquele ajuste: um núcleo, todos os núcleos, rajadas curtas, ritmo de quadros, latência para acordar um núcleo, timer, memória, disco e rede local. Depois testa combinações inéditas e confirma a melhor com 5 pares. No fim volta ao plano original e apaga o clone.',
      oQueAltera: 'Durante o teste: só o clone temporário do plano de energia. Depois: nada, a não ser que o modo autônomo adote uma combinação confirmada, que vira um plano novo "Nexo — Ajustado".',
      porQuePodeAjudar: 'Configurações ocultas do processador (EPP, modo de turbo, estacionamento de núcleos, política de aumento) mudam o quanto ele acelera e o quanto demora para acelerar. O efeito varia muito entre PCs, por isso o Nexo mede aqui em vez de seguir receita.',
      quandoNaoAjuda: 'Quando o gargalo é a placa de vídeo, o disco, a rede ou a temperatura. Em muitos PCs o resultado é "sem diferença", e o laboratório diz isso.',
      oQuePodeMudar: 'Durante o teste o PC esquenta e as ventoinhas aceleram por alguns minutos. Um ajuste adotado pode aumentar consumo e temperatura no dia a dia.',
      risco: 'moderado', reversivel: true, reversao: 'Automática ao terminar (sucesso, erro ou cancelamento). Se o PC travar no meio, uma trava e uma entrada RunOnce fazem o Nexo voltar ao plano original na próxima abertura ou entrada no Windows. Ponto de restauração do Windows antes de começar.',
      persistente: false, exigeReinicio: false, exigeAdmin: 'só para o ponto de restauração (UAC)',
      compat: { windows: 'Windows 10 e 11 (a validar em máquina real)', hardware: 'Ajustes que o firmware não expõe aparecem como indisponíveis e são pulados' },
      fontes: [MS('Opções de gerenciamento de energia do processador (Microsoft Learn)', 'https://learn.microsoft.com/windows-hardware/customize/power-settings/configure-processor-power-management-options'),
        MS('Checkpoint-Computer (Microsoft Learn)', 'https://learn.microsoft.com/powershell/module/microsoft.powershell.management/checkpoint-computer')],
      medicao: 'Pares intercalados; ganho = mediana das razões por par; ruído = meia amplitude da base; só conta acima de 3% e de 1,5× o ruído, com pelo menos 2/3 dos pares concordando. A combinação vencedora é reconfirmada com 5 pares.',
      estado: 'Motor e adaptador validados em dev contra um Windows simulado (testes). Aguarda validação em Windows real.'
    },
    {
      id: 'net-dns', titulo: 'Diagnóstico de rede: trocar o DNS da placa de rede', categoria: 'rede',
      mecanismo: 'Mede o DNS que o PC usa (nomes conhecidos e um nome novo, sem cache) contra 1.1.1.1 e 8.8.8.8. Se o da rede for bem mais lento, Set-DnsClientServerAddress grava os servidores da Cloudflare ou do Google (IPv4 e IPv6) só na placa da rota padrão e limpa o cache de DNS.',
      oQueAltera: 'Os servidores de DNS daquela placa de rede. Os outros ajustes de rede continuam iguais.',
      porQuePodeAjudar: 'Todo site novo espera a resposta do DNS antes de começar a abrir. DNS de roteador ou de operadora lento ou instável deixa a navegação lenta mesmo com a internet rápida.',
      quandoNaoAjuda: 'Quando a rede toda está lenta (os DNS públicos também demoram), em redes de empresa ou escola que precisam do DNS próprio, ou quando o atraso está no site ou no Wi-Fi.',
      oQuePodeMudar: 'Nomes que só o DNS da sua rede conhece (impressora, NAS por nome, rede da empresa) deixam de resolver. Controle parental feito pelo DNS do roteador deixa de valer neste PC.',
      risco: 'baixo', reversivel: true, reversao: 'Pelo Diário: volta aos servidores de antes (ou aos que a rede entrega por DHCP, se não havia fixos).',
      persistente: true, exigeReinicio: false, exigeAdmin: true,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer placa de rede' },
      fontes: [MS('Set-DnsClientServerAddress (Microsoft Learn)', 'https://learn.microsoft.com/powershell/module/dnsclient/set-dnsclientserveraddress'), MS('1.1.1.1: DNS público da Cloudflare', 'https://developers.cloudflare.com/1.1.1.1/'), MS('Google Public DNS', 'https://developers.google.com/speed/public-dns')],
      medicao: 'O próprio diagnóstico: mediana do tempo de resposta do DNS antes e depois, nos mesmos nomes.',
      estado: 'Lógica e validação dos dados testadas em dev. Aguarda validação em Windows real.'
    },
    {
      id: 'net-ipv4-prefer', titulo: 'Diagnóstico de rede: preferir IPv4 em vez de IPv6', categoria: 'rede',
      mecanismo: 'Liga o bit 0x20 de DisabledComponents em HKLM\\SYSTEM\\CurrentControlSet\\Services\\Tcpip6\\Parameters, mantendo os outros bits. Só é sugerido quando o PC tem IPv6 público mas nenhuma conexão por IPv6 completa.',
      oQueAltera: 'A ordem de preferência: o Windows tenta IPv4 antes de IPv6. O IPv6 continua ligado.',
      porQuePodeAjudar: 'Com IPv6 "meio quebrado", programas tentam o IPv6 primeiro e esperam antes de cair para o IPv4, atrasando cada conexão nova.',
      quandoNaoAjuda: 'Quando o IPv6 funciona, ou em redes só IPv6.',
      oQuePodeMudar: 'Quase nada no uso comum. Serviços que só existem em IPv6 continuam acessíveis.',
      risco: 'baixo', reversivel: true, reversao: 'Pelo Diário: volta o valor anterior (ou tira o valor, que é o padrão do Windows). Vale depois de reiniciar.',
      persistente: true, exigeReinicio: true, exigeAdmin: true,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Guidance for configuring IPv6 in Windows for advanced users (Microsoft Learn)', 'https://learn.microsoft.com/troubleshoot/windows-server/networking/configure-ipv6-in-windows')],
      medicao: 'O diagnóstico de rede mede a conexão por IPv4 e IPv6 antes; depois de reiniciar, rode de novo.',
      estado: 'Testado em dev. Aguarda validação em Windows real.'
    },
    {
      id: 'net-proxy-off', titulo: 'Diagnóstico de rede: desligar o proxy que não responde', categoria: 'rede',
      mecanismo: 'Grava ProxyEnable = 0 em HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings (só o seu usuário). O endereço do proxy fica guardado.',
      oQueAltera: 'Os programas que seguem o proxy do Windows passam a conectar direto.',
      porQuePodeAjudar: 'Um proxy que não responde (sobra de VPN, de programa desinstalado ou de malware) faz cada conexão esperar ou falhar.',
      quandoNaoAjuda: 'Em redes de empresa ou escola que exigem o proxy: lá, desligar corta a internet.',
      oQuePodeMudar: 'Se o proxy era necessário, os sites param de abrir até ligar de novo.',
      risco: 'baixo', reversivel: true, reversao: 'Pelo Diário: liga o proxy de novo, com o mesmo endereço.',
      persistente: true, exigeReinicio: false, exigeAdmin: false,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Usar um servidor proxy no Windows (Suporte Microsoft)', 'https://support.microsoft.com/windows/use-a-proxy-server-in-windows-03096c53-0554-4ffe-b6ab-8b1deee8dae1')],
      medicao: 'O diagnóstico testa se o proxy responde e mede um site de verdade antes e depois.',
      estado: 'Testado em dev. Aguarda validação em Windows real.'
    },
    {
      id: 'net-autodetect-off', titulo: 'Diagnóstico de rede: desligar a detecção automática de proxy', categoria: 'rede',
      mecanismo: 'Desliga o bit "Detectar configurações automaticamente" (WPAD) em DefaultConnectionSettings, no registro do seu usuário. Só é sugerido quando a procura demora mais de 1,5 s e não há script de proxy configurado.',
      oQueAltera: 'O Windows para de procurar um proxy na rede (WPAD) antes de conectar.',
      porQuePodeAjudar: 'Em casa quase nunca existe proxy, e a procura pode atrasar a primeira conexão de cada programa.',
      quandoNaoAjuda: 'Em redes de empresa que distribuem o proxy pelo WPAD.',
      oQuePodeMudar: 'Nessas redes, os programas deixam de achar o proxy sozinhos.',
      risco: 'baixo', reversivel: true, reversao: 'Pelo Diário: liga a detecção de novo. Também dá para mudar em Configurações > Rede > Proxy.',
      persistente: true, exigeReinicio: false, exigeAdmin: false,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('Usar um servidor proxy no Windows (Suporte Microsoft)', 'https://support.microsoft.com/windows/use-a-proxy-server-in-windows-03096c53-0554-4ffe-b6ab-8b1deee8dae1')],
      medicao: 'O diagnóstico mede quanto o Windows leva para decidir o proxy, antes e depois.',
      estado: 'Testado em dev. Aguarda validação em Windows real.'
    },
    {
      id: 'net-reset', titulo: 'Diagnóstico de rede: reparo profundo (Winsock e TCP/IP)', categoria: 'rede',
      mecanismo: 'netsh winsock reset, netsh int ip reset e ipconfig /flushdns, com administrador. Fica como último recurso, abaixo das outras correções.',
      oQueAltera: 'Volta o catálogo Winsock e a pilha TCP/IP às configurações padrão do Windows.',
      porQuePodeAjudar: 'Resolve conexões travadas ou lentas causadas por catálogo Winsock corrompido ou por sobras de programas de rede.',
      quandoNaoAjuda: 'Quando o problema é DNS, Wi-Fi, roteador ou a operadora: os outros testes do diagnóstico apontam isso antes.',
      oQuePodeMudar: 'IPs fixos e outras configurações manuais de TCP/IP voltam ao padrão; programas de VPN ou firewall de terceiros podem precisar ser reinstalados.',
      risco: 'moderado', reversivel: false, reversao: 'Não há reversão automática. Configurações manuais de rede precisam ser refeitas. Vale depois de reiniciar.',
      persistente: true, exigeReinicio: true, exigeAdmin: true,
      compat: { windows: 'Windows 10 e 11', hardware: 'Qualquer' },
      fontes: [MS('netsh winsock (Microsoft Learn)', 'https://learn.microsoft.com/windows-server/administration/windows-commands/netsh-winsock')],
      medicao: 'Rodar o diagnóstico de novo depois de reiniciar.',
      estado: 'Testado em dev. Aguarda validação em Windows real.'
    },
    {
      id: 'perf-log-users', titulo: 'Liberar a medição de FPS (grupo "Performance Log Users")', categoria: 'acesso',
      mecanismo: 'Add-LocalGroupMember -SID S-1-5-32-559 com o SID do seu usuário, executado com elevação (UAC). Usa o SID do grupo, que é igual em qualquer idioma do Windows.',
      oQueAltera: 'Coloca o seu usuário no grupo local que pode ler os eventos de desempenho usados pelo PresentMon.',
      porQuePodeAjudar: 'Sem o grupo (ou sem rodar como administrador), o PresentMon não consegue ler os quadros do jogo.',
      quandoNaoAjuda: 'Se você já roda o Nexo como administrador. O efeito só vale depois de sair e entrar de novo no Windows.',
      oQuePodeMudar: 'Programas que rodam com o seu usuário também passam a poder ler esses eventos de desempenho.',
      risco: 'baixo', reversivel: true, reversao: 'Remove-LocalGroupMember pelo Diário ou em Sessões > Componentes (pede UAC de novo).',
      persistente: true, exigeReinicio: true, exigeAdmin: true,
      compat: { windows: 'Windows 10 e 11 (módulo LocalAccounts do PowerShell 5.1)', hardware: 'Qualquer' },
      fontes: [MS('Add-LocalGroupMember (Microsoft Learn)', 'https://learn.microsoft.com/powershell/module/microsoft.powershell.localaccounts/add-localgroupmember'), MS('PresentMon: requisitos de acesso descritos no README do projeto (Intel, GitHub)', null, 'observada')],
      medicao: 'O Nexo confere o grupo antes e depois (whoami/token e Get-LocalGroupMember).',
      estado: 'Validado em dev (script e validação do SID). Aguarda validação em Windows real.'
    }
  ];

  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  /** Campos obrigatórios ausentes ou vazios. */
  function missingFields(entry) {
    return REQUIRED.filter((field) => {
      const value = entry[field];
      if (field === 'reversivel' || field === 'persistente' || field === 'exigeReinicio' || field === 'exigeAdmin') return value === undefined;
      return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    });
  }

  /** 27.12 a 27.14: consentimento por nível de risco. */
  function consentFor(risco) {
    const rank = RISK[risco];
    if (rank === undefined) return 'bloquear';
    if (rank >= RISK.critico) return 'bloquear';
    if (rank >= RISK.alto) return 'explicita-reforcada';
    if (rank >= RISK.moderado) return 'explicita';
    return 'confirmacao';
  }

  return {
    RISK, RISK_LABEL, REQUIRED,
    list: () => entries.slice(),
    get: (id) => byId.get(id) || null,
    missingFields, consentFor
  };
});
