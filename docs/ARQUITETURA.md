# Nexo Device Care — auditoria, arquitetura-alvo e plano

Resposta aos entregáveis 52.01 a 52.18 do prompt mestre, escrita sobre o código da versão 0.3.0. A regra de leitura é a do próprio prompt: **o que está marcado "validado em dev" passou em testes automatizados no Linux; o que está marcado "aguarda Windows real" ainda não rodou numa máquina de verdade.**

## 52.01 Resumo da arquitetura atual

Aplicativo desktop Electron com três camadas:

1. **Processo principal** (`main.cjs`): único ponto que toca o sistema. Expõe canais IPC (`registerIpcHandler`) que só aceitam chamadas do documento local confiável. Chama PowerShell, `powercfg`, `reg`, o instalador e o coletor de sensores.
2. **Coletor de sensores** (`sensor-host/`, .NET 10 + LibreHardwareMonitorLib): processo separado, somente leitura, devolve JSON.
3. **Interface** (`index.html`, `style.css`, `app.js`, `src/`): JavaScript sem framework, sem build. Fala com o principal pela ponte `window.nexoDesktop` (`preload.cjs`, `contextIsolation`, `sandbox`, CSP restrita).

Módulos de lógica **pura** (rodam e são testados fora do Electron): `brain.js` (análise e aprendizado), `catalog.js` (técnicas), `journal.js` (diário), `experiment.js` (estatística do A/B).

## 52.02 Inventário de módulos e funcionalidades

| Módulo | Função | Estado |
|---|---|---|
| `src/brain.js` | Médias por hora da semana, episódios de lentidão, programas recorrentes, previsão de disco, Índice Nexo, observações com evidência | validado em dev (8 testes) |
| `src/catalog.js` | 7 técnicas com mecanismo, risco, reversão, fontes, medição e estado de validação | validado em dev (testa campos obrigatórios) |
| `src/journal.js` | Diário de alterações, detecção de conflito na reversão | validado em dev |
| `src/experiment.js` | Mediana, ruído, veredito A/B, avisos de contexto | validado em dev; controle A contra A deu "sem diferença" |
| `main.cjs` → `bench:cpu` | Benchmark de CPU com `worker_threads`, cancelável | validado em dev (Linux) |
| `main.cjs` → limpeza | 4 categorias, filtro de idade, links ignorados, limite de 5.000 arquivos | validado em dev; Lixeira aguarda Windows real |
| `main.cjs` → energia/inicialização | `power:list`, `power:set` (valida GUID), `startup:list` | aguarda Windows real |
| `main.cjs` → desinstalação | Script PowerShell oculto + `NEXO_PURGE` | aguarda Windows real |
| `sensor-host` | Sensores de CPU, GPU, placa-mãe, memória, disco, rede, bateria | funciona (versões anteriores em uso) |
| `installer/installer.nsh` | Páginas de privacidade, `NEXO_KEEP`, limpeza total | aguarda compilação do NSIS |
| `installer-launcher/` | Instalador visual (PT/EN, aceite dos avisos) | UI validada com ponte simulada; empacotamento aguarda Windows |

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

`npm test` roda 3 arquivos, 26 testes, todos passando no Linux:

- `brain.test.cjs` (8): episódios, culpados, hábitos, previsão de disco, índice, serialização, feedback.
- `main-ipc.test.cjs` (9): carrega o `main.cjs` real com Electron simulado; limpeza, papel de parede, segurança de origem, links e documentação, benchmark com cancelamento.
- `catalog-journal-experiment.test.cjs` (9): completude do catálogo, consentimento por risco, diário e conflito de reversão, estatística do A/B.

**Não existe** teste automatizado de: NSIS, PowerShell, registro, `powercfg`, sensor-host, interface dentro do Electron real. Isso exige Windows (ver 52.15).

## 52.06 Capacidades atuais de acesso ao sistema

| Dado | Como é lido | Custo |
|---|---|---|
| CPU total, RAM, uptime | `os` do Node | desprezível |
| Temperaturas ACPI, GPU NVIDIA | PowerShell/CIM e `nvidia-smi`, em cache de 15 s | PowerShell por consulta |
| Sensores profundos (clock, temperatura, carga de GPU) | sensor-host a cada 15 s | processo residente |
| Discos | CIM, em cache de 30 s | PowerShell |
| Top de processos | PowerShell com amostra de 1 s | alto; só sob demanda ou em sobrecarga, no máximo a cada 2 min |
| Plano de energia, inicialização | CIM (`Win32_PowerPlan`, `Win32_StartupCommand`) | PowerShell |

## 52.07 Lacunas para telemetria profunda

Hoje **não** há: frame time/FPS (precisa de ETW/PresentMon), latência de DPC/ISR, fila e latência de disco por processo, contadores de rede por processo, uso de GPU por processo, causa de picos de frequência, e identificação do processo em primeiro plano. Sem isso, qualquer afirmação sobre "gargalo de jogo" seria suposição, e o Nexo **não faz** essa afirmação.

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
| D observação e sessões | histórico por minuto existe; **sessões com início/fim e relatório: próxima fatia** |
| E identificação de jogos | pendente (planejada por caminho de instalação, sem ler memória do jogo) |
| F diagnóstico explicável | parcial: 9 tipos de observação com evidência |
| G catálogo seguro e reversível | **iniciada nesta versão** (7 técnicas, 1 reversível) |
| H experimentos A/B e rollback | **iniciada nesta versão** (plano de energia) |
| I a R | pendentes |

## 52.14 Dependências candidatas (a validar antes de adotar)

- **ETW / PresentMon** para frame time: requer revisão de licença, privilégios e impacto; só após a fase D.
- **LibreHardwareMonitorLib** (já em uso): acompanhar suporte a CPUs/GPUs novas.
- **SQLite** para histórico estruturado: avaliar `better-sqlite3` (módulo nativo, afeta o empacotamento) contra `node:sqlite`.
- **ADB** para Android: executável de terceiros a ser baixado só com consentimento, com verificação de integridade.

## 52.15 Plano de validação em hardware real

Matriz mínima antes de qualquer release com a flag de ações: (1) Windows 10 e 11; (2) notebook na bateria e na tomada; (3) CPU Intel e AMD; (4) GPU NVIDIA, AMD e integrada; (5) SSD NVMe e HD. Roteiro por máquina: instalar → atualizar sobre a versão anterior (dados preservados?) → rodar cada técnica do catálogo → experimento de energia (3 execuções, ruído medido) → reverter → desinstalar (nada sobrou?). Registrar resultados no próprio catálogo (`estado`).

## 52.16 Plano de integração Android

Fases L a N do prompt: conexão por ADB com depuração USB autorizada pelo usuário, inventário somente leitura, diagnóstico de bateria e consumo, e só depois otimizações compatíveis e reversíveis. Limites desde já: nada de root, nada que contorne a autorização do aparelho, comandos de uma lista fechada, dados que ficam no PC.

## 52.17 Critérios para o laboratório beta (fase K)

Recurso de risco moderado ou maior só entra em modo beta isolado, desativado por padrão, com aviso, ponto de restauração antes de aplicar, reversão testada e registro no diário. Nunca: desativar Secure Boot, VBS, anti-cheat, assinatura de drivers ou proteções térmicas, nem alterar memória de outro processo.

## 52.18 Decisões que dependem de você

1. Qual perfil de usuário priorizar: jogador, trabalho/criação ou geral? Muda quais técnicas entram primeiro.
2. Aceita ETW/PresentMon (instalar ou embutir um componente de terceiros) para medir FPS?
3. Retenção padrão dos dados detalhados (hoje 7 dias) e se haverá exportação para análise externa.
4. Banco local: SQLite ou continuar com `localStorage` por enquanto?
5. Monitoramento em segundo plano (bandeja) como opção opt-in: aumenta a coleta e a lista de rastros a remover na desinstalação.
6. Certificado de assinatura de código: já existe um disponível?
7. Idioma inglês no app principal além do instalador.
