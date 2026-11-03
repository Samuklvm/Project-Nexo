# Nexo Device Care — auditoria, arquitetura-alvo e plano

Resposta aos entregáveis 52.01 a 52.18 do prompt mestre, escrita sobre o código da versão 0.4.0. A regra de leitura é a do próprio prompt: **o que está marcado "validado em dev" passou em testes automatizados no Linux; o que está marcado "aguarda Windows real" ainda não rodou numa máquina de verdade.**

## 52.01 Resumo da arquitetura atual

Aplicativo desktop Electron com três camadas:

1. **Processo principal** (`main.cjs`): único ponto que toca o sistema. Expõe canais IPC (`registerIpcHandler`) que só aceitam chamadas do documento local confiável. Chama PowerShell, `powercfg`, `reg`, o instalador e o coletor de sensores.
2. **Coletor de sensores** (`sensor-host/`, .NET 10 + LibreHardwareMonitorLib): processo separado, somente leitura, devolve JSON.
3. **Interface** (`index.html`, `style.css`, `app.js`, `src/`): JavaScript sem framework, sem build. Fala com o principal pela ponte `window.nexoDesktop` (`preload.cjs`, `contextIsolation`, `sandbox`, CSP restrita).

Módulos de lógica **pura** (rodam e são testados fora do Electron): `brain.js` (análise e aprendizado), `catalog.js` (técnicas), `journal.js` (diário), `experiment.js` (estatística do A/B).

## 52.02 Inventário de módulos e funcionalidades
| Módulo | Função | Estado |
|---|---|---|
| `src/brain.js` | Médias por hora da semana, episódios de lentidão, programas recorrentes, previsão de disco, Índice Nexo (com pesos do perfil), observações com evidência | validado em dev |
| `src/profiles.js` | Perfis Jogos, Trabalho e criação, Uso geral: pesos do índice, realce das observações, ordem dos achados e dicas | validado em dev |
| `src/catalog.js`, `src/journal.js`, `src/experiment.js` | Técnicas com ficha, diário reversível, estatística do A/B | validado em dev |
| `src/session.js` | Análise de sessão: estatísticas, detecção de jogo por pasta, gargalo de GPU, de um núcleo, de memória, térmico, programas em segundo plano, achados com evidência e limites | validado em dev (sessões sintéticas) |
| `src/fps.js` | Lê o CSV do PresentMon por nome de coluna, FPS médio, 1% e 0,1% baixos, quadros lentos, limitado por CPU ou GPU | validado em dev |
| `electron/probe.cjs` | Um PowerShell residente: primeiro plano, CPU e GPU por programa, custo da própria sonda. O caminho do executável nunca sai do processo principal | lógica validada com processo simulado; **o script PowerShell aguarda Windows real** |
| `electron/fps-runner.cjs` | Executa o PresentMon (opt-in), valida o PID, traduz “acesso negado” em instrução clara, encerra a sessão ETW | lógica validada com processo simulado; **o PresentMon real aguarda Windows** |
| `scripts/fetch-presentmon.cjs` | Baixa a versão fixada e confere o SHA-256; sem hash fixado, não baixa nada | validado em dev; **o hash ainda precisa ser fixado por uma pessoa** |
| `main.cjs` | IPC, limpeza, energia, benchmark, sessão, desinstalação | validado em dev (exceto o que chama o Windows) |
| `sensor-host`, `installer/installer.nsh`, `installer-launcher/` | Sensores, instalador NSIS, instalador visual | como na 0.3.0 |

## 52.03 Mapa de dependências

```
renderer (src/*.js) ──IPC──> main.cjs ──> PowerShell / powercfg / reg / sfc / Optimize-Volume
                                      ├─> sensor-host (stdout JSON) ──> LibreHardwareMonitorLib
                                      ├─> worker_threads (benchmark)
                                      └─> electron-updater ──> GitHub Releases (único tráfego de rede)
brain.js / catalog.js / journal.js / experiment.js  (puros; sem dependências)
```

## 52.04 Stack e versões

Electron 37.2.0 · electron-builder 26.0.12 · electron-updater 6.8.9 · .NET `net10.0` · LibreHardwareMonitorLib 0.9.6 · Node 20+ no CI (os testes foram rodados no Node 22). Windows 10/11 x64.

## 52.05 Estado dos testes
`npm test` roda 5 arquivos, 53 testes, todos passando no Linux:

- `brain.test.cjs` (8) e `catalog-journal-experiment.test.cjs` (13, incluindo os perfis).
- `main-ipc.test.cjs` (10): carrega o `main.cjs` real com Electron simulado.
- `session-fps.test.cjs` (15): sessões sintéticas de cada tipo de gargalo, detecção de jogo, parser de FPS nos formatos novo e antigo.
- `probe-fps-runner.test.cjs` (7): sonda e executor de FPS com processos filhos simulados; política do hash do PresentMon.

**Não existe** teste automatizado de: NSIS, PowerShell real, registro, `powercfg`, sensor-host, PresentMon real, interface dentro do Electron real. Isso exige Windows (ver 52.15).

## 52.06 Capacidades atuais de acesso ao sistema
| Dado | Como é lido | Custo |
|---|---|---|
| CPU total e por núcleo, RAM, uptime | `os` do Node | desprezível |
| Temperaturas ACPI, GPU NVIDIA | PowerShell/CIM e `nvidia-smi`, em cache de 15 s | PowerShell por consulta |
| Sensores profundos (clock, temperatura, carga de GPU) | sensor-host a cada 15 s (5 s durante uma sessão) | processo residente |
| Discos | CIM, em cache de 30 s | PowerShell |
| Top de processos | PowerShell com amostra de 1 s, só sob demanda ou em sobrecarga | alto |
| Plano de energia, inicialização | CIM (`Win32_PowerPlan`, `Win32_StartupCommand`) | PowerShell |
| Programa em primeiro plano | `GetForegroundWindow` por P/Invoke, no PowerShell residente da sonda | uma sonda por sessão |
| Uso de GPU por programa | CIM `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine` (contador do Windows, independente de idioma) | na sonda, a cada ~5 s |
| FPS e tempo de quadro | PresentMon (ETW), processo separado, só com a opção ligada | medido e mostrado na sessão |
| Custo do próprio Nexo | `app.getAppMetrics` + custo da sonda | desprezível; **não inclui o PresentMon** |

## 52.07 Lacunas para telemetria profunda
Continuam **sem** leitura: latência de DPC/ISR, fila e latência de disco por processo, contadores de rede por processo, causa de picos de frequência (limite de energia contra térmico) e motivos de limitação da GPU (existem no `nvidia-smi`, ainda não integrados). Passaram a ser **possíveis, mas não validados em Windows real**: programa em primeiro plano, GPU por programa e FPS. Mesmo com FPS, o Nexo só aponta indícios: um achado nunca é dado como causa provada.

## 52.08 Riscos técnicos e de segurança

1. Scripts PowerShell por texto: mitigado por constantes, GUID validado e `-Command` com aspas simples escapadas; ainda é superfície a revisar em Windows real.
2. Desinstalação completa apaga dados: mitigada por `NEXO_KEEP` (atualização) e `NEXO_PURGE`; **precisa de teste de atualização sobre versão anterior**.
3. Executável que roda outro em silêncio (launcher) pode ser marcado por antivírus: assinar ambos.
4. `powercfg` pode exigir administrador em alguns sistemas (documentação antiga): a UI trata erro e o catálogo marca "a validar".
5. Benchmark usa 100% da CPU por ~20 s: sempre iniciado pelo usuário, bloqueado com CPU ≥ 80% ou temperatura ≥ 88 °C, aviso na bateria, cancelável.
6. Dados locais crescem: retenção fixa (7 dias, 120 episódios, 100 registros no diário). Retenção configurável ainda não existe.
7. O PNG de 26 MB permanece no histórico do Git (não no pacote).

## 52.09 Arquitetura-alvo

Pipeline em camadas, cada uma com contrato próprio e nenhuma pulando a seguinte:

**Observação → Análise → Recomendação → Autorização → Execução → Medição → Reversão → Auditoria**

- Observação e Análise nunca alteram o sistema.
- Recomendação aponta uma entrada do **catálogo** e leva a evidência.
- Autorização depende do risco (`consentFor`): baixo = confirmação; moderado = explícita; alto = reforçada; crítico = bloqueado.
- Execução é um **executor determinístico** com lista fechada de operações. Nenhum texto livre (nem de IA) vira comando.
- Medição compara antes e depois contra o ruído; sem melhora medida, não se afirma melhora.
- Reversão usa o estado anterior guardado no diário e avisa de conflitos.
- Auditoria: tudo vai para o diário.

## 52.10 Fluxo principal (texto)

```
[Sensores 5 s] -> store (ao vivo) -> a cada 1 min: histórico + brain.ingest
brain -> episódios / culpados / hábitos -> insights (evidência, confiança)
insight -> catálogo (técnica) -> diálogo de autorização -> executor (IPC)
executor -> diário (antes/depois) -> [opcional] experimento A/B
experimento: bench A -> aplica -> bench B -> compare() -> usuário mantém ou reverte -> diário
```

## 52.11 Contratos dos módulos centrais

```
Amostra        { t, cpu, mem, disk, gpu, temp, clock?, clockRatio?, culprit? }
Episódio       { kind: cpu|memory|thermal|throttle, start, end, peak, minutes, culprit? }
Observação     { id, category, severity, title, summary, evidence[], actions[], confidence, votes }
Técnica        { id, titulo, categoria, mecanismo, oQueAltera, porQuePodeAjudar, quandoNaoAjuda,
                 oQuePodeMudar, risco, reversivel, reversao, persistente, exigeReinicio, exigeAdmin,
                 compat, fontes[{titulo,url,evidencia}], medicao, estado }
Diário         { id, at, actionId, title, risk, reversible, before, after, detail, status,
                 authorization, measure, revertedAt, revertNote }
Experimento    { repeticoes, benchMs, single:{deltaPct,noisePct,verdict,confidence}, multi:{...}, verdict }
Benchmark IPC  bench:cpu({mode:'single'|'multi', ms:200..3000}) -> { mode, threads, ms, mopsPerSec }
```

## 52.12 Modelo de dados inicial

Tudo em `localStorage` do app (pasta de dados do usuário), exceto o papel de parede (arquivo): `nexo-performance-history` (7 dias, por minuto), `nexo-brain-v1` (168 faixas, episódios, programas), `nexo-recommendation-feedback` (até 100), `nexo-journal-v1` (até 100), `nexo-activity` (20). Exportável e apagável em Ajustes. Próximo passo de dados: migrar para SQLite local com versão de esquema e retenção configurável (decisão pendente, ver 52.18).

## 52.13 Plano de fases (prompt mestre, seção 50)

| Fase | Situação |
|---|---|
| A auditoria | feita (este documento) |
| B arquitetura e contratos | contratos acima; telemetria ainda sem esquema versionado |
| C inventário de hardware | parcial (sensores); falta inventário de sistema |
| D observação e sessões | **concluída em dev**: grava, analisa, salva, exporta; aguarda validação em Windows real |
| E identificação de jogos | **parcial**: heurística por pasta de biblioteca + marcação manual; nunca lê a memória do jogo |
| F diagnóstico explicável | parcial: 9 tipos de observação com evidência |
| G catálogo seguro e reversível | **iniciada nesta versão** (7 técnicas, 1 reversível) |
| H experimentos A/B e rollback | **iniciada nesta versão** (plano de energia) |
| I a R | pendentes |

## 52.14 Dependências candidatas (a validar antes de adotar)
- **PresentMon (adotado como componente opcional)**: licença MIT (Copyright Intel), versão mais recente conferida v2.6.0, flags da 2.x conferidas no README oficial. Exige o grupo “Performance Log Users” ou administrador. Versão e SHA-256 ficam em `third-party/presentmon.lock.json`; **sem hash fixado nada é embutido**. Compatibilidade com anti-cheats: **a validar**, não afirmada.
- **LibreHardwareMonitorLib** (já em uso): acompanhar suporte a CPUs/GPUs novas.
- **NVML / `nvidia-smi`** para motivos de limitação da GPU: candidata, ainda não integrada (o nome do campo mudou entre versões do driver).
- **SQLite** para histórico estruturado: avaliar `better-sqlite3` (módulo nativo, afeta o empacotamento) contra `node:sqlite`.
- **ADB** para Android: executável de terceiros baixado só com consentimento, com verificação de integridade.

## 52.15 Plano de validação em hardware real

Matriz mínima antes de qualquer release com a flag de ações: (1) Windows 10 e 11; (2) notebook na bateria e na tomada; (3) CPU Intel e AMD; (4) GPU NVIDIA, AMD e integrada; (5) SSD NVMe e HD. Roteiro por máquina: instalar → atualizar sobre a versão anterior (dados preservados?) → rodar cada técnica do catálogo → experimento de energia (3 execuções, ruído medido) → reverter → desinstalar (nada sobrou?). Registrar resultados no próprio catálogo (`estado`).

## 52.16 Plano de integração Android

Fases L a N do prompt: conexão por ADB com depuração USB autorizada pelo usuário, inventário somente leitura, diagnóstico de bateria e consumo, e só depois otimizações compatíveis e reversíveis. Limites desde já: nada de root, nada que contorne a autorização do aparelho, comandos de uma lista fechada, dados que ficam no PC.

## 52.17 Critérios para o laboratório beta (fase K)

Recurso de risco moderado ou maior só entra em modo beta isolado, desativado por padrão, com aviso, ponto de restauração antes de aplicar, reversão testada e registro no diário. Nunca: desativar Secure Boot, VBS, anti-cheat, assinatura de drivers ou proteções térmicas, nem alterar memória de outro processo.

## 52.18 Decisões que dependem de você
**Respondidas por você:** (1) o perfil é uma escolha entre três opções (Jogos, Trabalho e criação, Uso geral), trocável a qualquer momento; (2) PresentMon e outras extensões/APIs liberadas; (3) começar pelas sessões de observação.

**Em aberto:**

1. **Fixar o hash do PresentMon** (ação sua): rode `npm run presentmon:hash`, compare com o digest que o GitHub mostra na página da release e cole em `third-party/presentmon.lock.json`.
2. Permissão do PresentMon: o Nexo hoje **explica** como entrar no grupo “Performance Log Users”. Quer um botão que peça elevação (UAC) para fazer isso por você?
3. Iniciar a sessão automaticamente ao detectar um jogo? Exige manter a sonda ligada fora das sessões (mais coleta, sempre opt-in).
4. Qual técnica medir no experimento A/B depois do plano de energia (por exemplo, o Modo de Jogo do Windows)?
5. Banco local: SQLite ou continuar com `localStorage`?
6. Monitoramento em segundo plano (bandeja), certificado de assinatura de código e idioma inglês no app principal: continuam pendentes.
