# Cortex v0 + Memória eterna — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** dar ao Nexo uma memória que nunca apaga e um cérebro (Cortex) que, sem IA, abre investigações a partir de
anomalias, levanta ≥ 3 hipóteses, escolhe o teste que mais separa, executa pelo laboratório e conclui com estado
honesto (ou "não achei").

**Architecture:** módulos puros e UMD em `src/cortex/` (mapa de relações, forjador, crença, planejador, narrador e o
motor de investigação com dependências injetadas), testados contra PCs simulados. A memória (`node:sqlite`) e a
orquestração moram no processo principal (`src/cortex/memory.cjs`, `src/cortex/cortex.cjs`), ligadas ao `main.cjs`
por IPC. A interface alimenta o Cortex (minutos, lentidões, sessões, lab) e mostra o Caderno na página de Análise.

**Tech Stack:** Electron 45 (Node 24 no principal), `node:sqlite` (`DatabaseSync` e `backup`), `node:test` (Node 22 nos
testes), JavaScript sem dependências novas.

**Spec:** `docs/superpowers/specs/2026-11-24-cortex-memoria-eterna-design.md` (ler antes de começar).

## Global Constraints

- Sem dependências npm novas. `node:sqlite` já existe no Electron 45 (verificado: Node 24.22, `DatabaseSync` e
  `backup` presentes) e no Node 22 dos testes.
- **Memória eterna:** nenhuma tabela eterna aceita `UPDATE` nem `DELETE` (gatilho no próprio SQLite). Não existe API
  nem botão para apagar a memória eterna. Só a tabela da câmera lenta (`camera`) pode ser podada.
- O botão "Apagar aprendizado e histórico" continua zerando **só** o cérebro antigo (`brain.js` + histórico local).
- **Sem IA:** nada do Cortex depende de `mind.js`; `mind.available()` devolve `false` na v0.
- Nunca escrever "provavelmente", "talvez seja", "deve ser" em textos do Cortex. Estados permitidos:
  `suspeita`, `correlacionada`, `apoiada`, `derrubada`, `nao-resolvido`.
- "Apoiada" só com prova de teste (`medir` ou `intervir`) cujo resultado passou do ruído (`NexoExperiment`).
- Intervenção só dentro do espaço fechado do laboratório; nunca com o PC em uso (ocioso ≥ 10 min por
  `powerMonitor.getSystemIdleTime()`); no máximo **3 ações ativas (`medir`/`intervir`) por dia**.
- Nada sai do PC; falhas do Cortex vão para `errorLog.record({ source: 'cortex', ... })`.
- Textos públicos (política de privacidade) em PT e EN. **Nada de CHANGELOG**: anotar em
  `claude/pendente-proxima-versao.md` (doc do projeto).
- Os testes atuais (`npm test`) continuam passando; arquivos de teste novos entram na lista do script `test`.

## Review Focus

1. **Banco corrompido, travado ou disco cheio:** o Cortex se desliga sozinho, registra o erro e o app segue normal;
   na abertura seguinte tenta a cópia de segurança mais recente (Task 1 e Task 8).
2. **App fechado no meio de uma investigação:** na abertura seguinte a investigação continua de onde parou, só
   lendo os registros (Task 7).
3. **A mesma lentidão repetindo muitas vezes:** vira prova nova da investigação aberta, não dezenas de investigações
   (Task 7).
4. **Pessoa começa a jogar com um teste na fila:** ação ativa nunca começa sem ociosidade; se a ociosidade acabar
   antes de começar, fica para depois (Task 6 e Task 8).
5. **Anos de memória:** consultas sempre por intervalo e com limite; um dia de minutos entre 500 mil linhas responde
   em < 200 ms (Task 1).

---

### Task 1: Memória eterna (`src/cortex/memory.cjs`)

**Files:**
- Create: `src/cortex/memory.cjs`
- Test: `tests/cortex-memory.test.cjs`
- Modify: `package.json` (script `test`: incluir `tests/cortex-memory.test.cjs`)

**Interfaces:**
- Produces:
  - `createMemory({ dir: string, now?: () => number, flushMs?: number = 4000, cameraMaxBytes?: number = 200 * 1024 * 1024 }) -> { ok: true, memory } | { ok: false, error: string }`
  - `memory.addMinute({ t, cpu, mem, disk, gpu, temp, cpuTemp, clock, clockRatio, culprit })` — enfileira; rejeita `t` > `now() + 5 min`.
  - `memory.addEvent({ kind: string, at: number, data: object }) -> number` (id)
  - `memory.addMachine(snapshot: object)` — só grava se diferente do último retrato (JSON canônico).
  - `memory.record(kind: RecordKind, { inv?: number, ref?: number, prev?: number, data: object }) -> number` (id);
    `RecordKind = 'investigacao'|'hipotese'|'crenca'|'experimento'|'prova'|'conclusao'|'relacao'|'pensamento'|'necessidade'|'trecho'|'pedido'|'ajuste'`
  - `memory.latest(kind, { inv?, ref? }) -> Row|null`, `memory.list(kind, { inv?, since?, limit = 50 }) -> Row[]`
    (`Row = { id, at, kind, inv, ref, prev, data }`)
  - `memory.minutes({ from, to, limit = 2000 }) -> MinuteRow[]`, `memory.events({ from, to, kind?, limit = 200 })`
  - `memory.camera.put(sessionId: string, samples: object[])`, `memory.camera.cite(sessionId, from, to) -> number`
    (copia o trecho para um registro `trecho` e devolve o id), `memory.camera.prune()` (apaga sessões inteiras mais
    antigas até caber em `cameraMaxBytes`).
  - `memory.backupDaily() -> Promise<string|null>` (arquivo criado ou `null` se já houve hoje); guarda as 3 últimas em
    `dir/backups/`.
  - `memory.importLegacy({ history: MinuteRow[], brain: object }) -> { imported: number }` (idempotente via `meta`).
  - `memory.sizeBytes() -> number`, `memory.flush()`, `memory.close()`, `memory.getMeta(key)`, `memory.setMeta(key, value)`.
  - `latest/list/minutes/events` são a API de "lembrar" do spec: é por elas que a IA local (parte 3) vai ler a memória.

- [ ] **Step 1: Write the failing tests** em `tests/cortex-memory.test.cjs` (pasta temporária por teste):
  - `grava e lê minutos depois do flush`: 3 `addMinute`, `flush()`, `minutes({from,to})` tem 3 linhas em ordem.
  - `minuto do futuro não entra`: `t = now() + 6 * 60000` → 0 linhas.
  - `tabelas eternas recusam UPDATE e DELETE`: `memory._db.exec('DELETE FROM registros')` e
    `UPDATE registros SET kind='x'` lançam erro; o mesmo para `minutos`, `eventos`, `maquina`. `DELETE FROM camera` funciona.
  - `record encadeia versões`: `record('crenca', {inv:1, data:{p:0.3}})` e depois com `prev` → `latest('crenca',{inv:1}).data.p === 0.6` e `list` traz as 2.
  - `addMachine não duplica retrato igual`: dois iguais e um diferente → 2 linhas.
  - `câmera: cite copia trecho e prune nunca apaga trecho`: put de 3 sessões grandes, cite um intervalo da primeira,
    `prune()` com teto baixo remove sessões da câmera, e o registro `trecho` continua com as mesmas amostras.
  - `backup diário guarda só 3`: com `now` avançando 5 dias, 5 chamadas → 3 arquivos; segunda chamada no mesmo dia → `null`.
  - `importLegacy é idempotente`: duas chamadas com 100 minutos → `imported` 100 e depois 0; minutos marcados `origem='importado'`.
  - `arquivo corrompido não derruba`: escrever lixo em `dir/memoria.db` → `createMemory` devolve `{ ok:false }`;
    se existir backup em `dir/backups/`, renomeia o corrompido para `memoria.corrompido-<t>.db`, restaura o backup e devolve `{ ok:true }`.
  - `consulta de um dia em 500 mil minutos < 200 ms` (inserção em lote direta para montar o cenário).
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/cortex-memory.test.cjs` → FAIL (`Cannot find module`).
- [ ] **Step 3: Implementar** com `require('node:sqlite').DatabaseSync`, `PRAGMA journal_mode=WAL`,
  `PRAGMA user_version` para versão do esquema (1). Tabelas: `minutos(t INTEGER PRIMARY KEY, cpu, mem, disk, gpu, temp, cpuTemp, clock, clockRatio, culprit, origem)`,
  `eventos(id, at, kind, data)`, `maquina(id, at, data)`, `registros(id, at, kind, inv, ref, prev, data)`,
  `camera(session, t, data)`, `meta(key PRIMARY KEY, value)` (só `meta` e `camera` aceitam escrita fora de INSERT).
  Índices: `registros(kind, inv, id)`, `eventos(at)`, `camera(session, t)`. Gatilhos
  `BEFORE UPDATE/DELETE ... SELECT RAISE(ABORT, 'memoria eterna')` em `minutos`, `eventos`, `maquina`, `registros`.
  Fila em memória com `setTimeout(flushMs).unref()` e uma transação por flush. Backup com `require('node:sqlite').backup(db, arquivo)`.
- [ ] **Step 4: Rodar e ver passar** — `node --test tests/cortex-memory.test.cjs` → PASS.
- [ ] **Step 5: Commit** — `git add src/cortex/memory.cjs tests/cortex-memory.test.cjs package.json && git commit -m "Cortex: memória eterna em SQLite"`

### Task 2: Mapa de relações (`src/cortex/relations.js`)

**Files:**
- Create: `src/cortex/relations.js` (UMD, como `src/brain.js`; no navegador vira `NexoRelations`)
- Test: `tests/cortex-relations.test.cjs`; Modify: `package.json`

**Interfaces:**
- Consumes: `require('../lab-space.js')` (`SPACE`, `LINUX_SPACE`, campo `affects`).
- Produces:
  - `SIGNALS: Record<string, { label: string, unit?: string }>` — no mínimo: `cpu, mem, disk, gpu, temp_cpu, temp, clock_queda, page_faults, travadas, quadros_ruins, programa_pesado, rotina, bench:<id>` e `ajuste:<knobId>`.
  - `STATES = ['semente','observada','correlacionada','suspeita','apoiada','derrubada']`
  - `seedEdges() -> Edge[]`, `Edge = { id: string, from: string, to: string, type: 'causa'|'explica'|'afeta', weight: number (0..1), origem: 'semente'|'correlacao' }`.
    Semente geral (pelo menos: `temp_cpu→clock_queda`, `programa_pesado→cpu`, `mem→page_faults`, `page_faults→travadas`,
    `cpu→travadas`, `clock_queda→cpu`, `gpu→quadros_ruins`, `disk→travadas`) **mais** uma aresta `ajuste:<knob>→bench:<b>`
    (`afeta`) para cada `affects` de cada ajuste do lab.
  - `createMap(edges: Edge[], history: EdgeEvent[]) -> Map` com `map.state(edgeId) -> State`, `map.causesOf(signal) -> Edge[]`
    (ordenado por peso × histórico desta máquina), `map.apply(event: EdgeEvent)`, `map.edges()`.
    `EdgeEvent = { edgeId, kind: 'visto'|'correlacao'|'suspeita'|'experimento-a-favor'|'experimento-contra', at }`.
    Escada: `visto→observada`, `correlacao→correlacionada`, `suspeita→suspeita`, `experimento-a-favor→apoiada`,
    `experimento-contra→derrubada`. **Nenhum evento que não seja experimento leva a `apoiada`.**
  - `mineCorrelations(minutes: MinuteRow[], known: Edge[], { maxLag = 5, minN = 60, minR = 0.6 }) -> Edge[]` — pares de
    colunas numéricas dos minutos com correlação de Pearson ≥ `minR` em algum atraso 0..`maxLag`, que não existem em
    `known`; devolve `origem:'correlacao'`, `weight = r`.
- [ ] **Step 1: Write the failing tests:** semente tem `temp_cpu→clock_queda` e uma aresta `ajuste:perfepp→bench:single`;
  `causesOf('clock_queda')` inclui `temp_cpu`; correlação sozinha nunca vira `apoiada`; `experimento-contra` leva a
  `derrubada`; `mineCorrelations` acha `gpu→temp` com atraso 2 num par sintético (r≈0.9) e não devolve nada para 2 ruídos
  independentes (seed fixa) nem para par que já está em `known`.
- [ ] **Step 2: Rodar e ver falhar** — `node --test tests/cortex-relations.test.cjs`.
- [ ] **Step 3: Implementar** as funções acima (puras, sem acesso a disco).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `git commit -m "Cortex: mapa de relações com semente, escada e correlações novas"`

### Task 3: Forjador de hipóteses (`src/cortex/forge.js`)

**Files:** Create `src/cortex/forge.js` (UMD → `NexoForge`); Test `tests/cortex-forge.test.cjs`; Modify `package.json`.

**Interfaces:**
- Consumes: `createMap` / `Edge` (Task 2).
- Produces:
  - `Anomaly = { kind: 'lentidao'|'sessao'|'lab'|'curiosidade', symptom: string (SIGNALS), at: number, window: { from, to }, data: object }`
  - `Hypothesis = { key: string, cause: string, symptom: string, via: string[] (edge ids), prior: number, source: 'mapa'|'correlacao'|'rotina'|'desconhecida', predictions: Prediction[] }`
  - `Prediction = { action: 'lembrar'|'esperar'|'medir'|'intervir', target: string, expect: 'sobe'|'desce'|'igual'|'presente'|'ausente' }`
  - `forge(anomaly: Anomaly, map, extra: { correlations?: Edge[] } = {}) -> Hypothesis[]` — sempre ≥ 3 e sempre com
    `rotina` ("é a variação normal desta máquina neste horário") e `desconhecida` ("causa fora do que eu consigo medir
    hoje"; sem previsões testáveis, `prior` 0.1). As de `mapa` vêm de `causesOf` em até 2 saltos; `correlacao` de
    `extra.correlations` que chegam no sintoma. `key` estável = `cause>symptom`. Priors normalizados (soma 1).
- [ ] **Step 1: Write the failing tests:** lentidão de `clock_queda` → ≥ 3 hipóteses, contém `temp_cpu` (mapa), `rotina`
  e `desconhecida`, soma dos priors ≈ 1; sintoma sem nenhuma causa no mapa ainda dá 3 (com 1 correlação injetada) e,
  sem correlação, dá `rotina` + `desconhecida` + causa de 2 saltos; toda hipótese exceto `desconhecida` tem ≥ 1 previsão;
  nenhum texto/lista fixa por sintoma no módulo (teste lê o arquivo e garante que não há `switch`/mapa
  `symptom → hipóteses`: só `causesOf`).
- [ ] **Step 2–4:** falhar, implementar, passar (`node --test tests/cortex-forge.test.cjs`).
- [ ] **Step 5: Commit** — `git commit -m "Cortex: forjador de hipóteses"`

### Task 4: Crença e conclusão (`src/cortex/beliefs.js`)

**Files:** Create `src/cortex/beliefs.js` (UMD → `NexoBeliefs`); Test `tests/cortex-beliefs.test.cjs`; Modify `package.json`.

**Interfaces:**
- Consumes: `Hypothesis` (Task 3); `require('../experiment.js')` só via `outcome.significant` (o executor já decide).
- Produces:
  - `Outcome = { action: 'lembrar'|'esperar'|'medir'|'intervir', target: string, observed: 'sobe'|'desce'|'igual'|'presente'|'ausente', significant: boolean, evidenceId?: number }`
  - `update(hyps: Hypothesis[], beliefs: Record<key, number>, outcome: Outcome) -> Record<key, number>` — verossimilhança
    0.85/0.15 quando a previsão bate/erra com `significant`; 0.55/0.45 sem `significant`; hipóteses sem previsão para
    aquele alvo ficam com 0.5; renormaliza.
  - `verdict(hyps, beliefs, outcomes: Outcome[]) -> { status: 'aberta'|'apoiada'|'correlacionada'|'nao-resolvido', winner: key|null, refuted: key[] }`
    com `SUPPORT = 0.8`, `REFUTE = 0.05`: `apoiada` exige crença ≥ 0.8 **e** um outcome `medir`/`intervir` significativo
    que bateu com o vencedor; ≥ 0.8 sem isso = `correlacionada`; `refuted` = crença < 0.05 com previsão errada significativa.
    `nao-resolvido` é decidido pelo motor (Task 7), não aqui.
- [ ] **Step 1: Write the failing tests:** previsão confirmada sobe a crença; sem `significant` sobe pouco (< 0.1 de
  diferença); duas confirmações por `lembrar` levam no máximo a `correlacionada`; uma `intervir` significativa a favor leva a
  `apoiada`; previsão errada significativa derruba; `desconhecida` nunca vira `apoiada`.
- [ ] **Step 2–4:** falhar, implementar, passar.
- [ ] **Step 5: Commit** — `git commit -m "Cortex: crença e regras de conclusão"`

### Task 5: Narrador (`src/cortex/narrate.js`)

**Files:** Create `src/cortex/narrate.js` (UMD → `NexoNarrate`); Test `tests/cortex-narrate.test.cjs`; Modify `package.json`.

**Interfaces:**
- Consumes: `SIGNALS` (Task 2), `Hypothesis`, `Outcome`, verdict (Tasks 3–4).
- Produces: `say(step: { type: 'notei'|'suspeito'|'plano'|'resultado'|'conclusao'|'necessidade'|'pedido', ... }) -> string`
  em português simples, com números quando existirem (vírgula decimal).
- [ ] **Step 1: Write the failing tests:** um caso de cada `type` produz frase não vazia que cita o sinal pelo `label`;
  nenhuma saída (rodar todos os tipos com vários dados) contém `/provavelmente|talvez seja|deve ser|com certeza/i`;
  `conclusao` com `nao-resolvido` diz o que foi descartado e o que faltou medir.
- [ ] **Step 2–4:** falhar, implementar, passar.
- [ ] **Step 5: Commit** — `git commit -m "Cortex: narrador do pensamento"`

### Task 6: Planejador (`src/cortex/planner.js`)

**Files:** Create `src/cortex/planner.js` (UMD → `NexoPlanner`); Test `tests/cortex-planner.test.cjs`; Modify `package.json`.

**Interfaces:**
- Consumes: `Hypothesis`, `Prediction`, beliefs (Tasks 3–4).
- Produces:
  - `Action = { type: 'lembrar'|'esperar'|'medir'|'intervir', target: string, cost: number, risk: 'nenhum'|'baixo'|'moderado'|'alto' }`
    com `COST = { lembrar: 0.05, esperar: 0.3, medir: 1, intervir: 3 }`; `target` de `intervir` é `ajuste:<knobId>` e
    o risco vem do ajuste no `lab-space.js`.
  - `actionsFor(hyps) -> Action[]` (uma por alvo distinto nas previsões, sem repetir).
  - `expectedGain(action, hyps, beliefs) -> number` — redução esperada da entropia (bits) sobre as crenças, agrupando
    as hipóteses pelo `expect` que preveem para aquele alvo (sem previsão = grupo "indiferente", espalhado).
  - `choose(hyps, beliefs, ctx: { permission: 'observar'|'pedir'|'sozinho', maxRisk: 'baixo'|'moderado'|'alto', activeToday: number, idle: boolean, done: string[] }) -> { action: Action, needsApproval: boolean } | { need: { between: key[], reason: string } } | { stop: 'orcamento' }`
    — melhor `gain / cost` entre as ações ainda não feitas (`done` = `type:target`); `intervir` some com
    `permission = 'observar'` ou risco acima de `maxRisk`; `medir`/`intervir` somem com `!idle` ou `activeToday >= 3`;
    `needsApproval = (type === 'intervir' && permission === 'pedir')`; melhor ganho < `MIN_GAIN = 0.05` bits → `need`.
- [ ] **Step 1: Write the failing tests:** entre `lembrar` que não separa nada e `medir` que separa 2 hipóteses
  igualmente prováveis, escolhe `medir`; com mesma separação escolhe a mais barata; `observar` nunca devolve `intervir`;
  `!idle` nunca devolve `medir`/`intervir` (Review Focus 4); `activeToday = 3` idem; nada que separe → `need` com as
  hipóteses empatadas; `pedir` + `intervir` → `needsApproval: true`.
- [ ] **Step 2–4:** falhar, implementar, passar.
- [ ] **Step 5: Commit** — `git commit -m "Cortex: planejador por ganho de informação"`

### Task 7: Motor de investigação + PCs simulados (`src/cortex/engine.js`)

**Files:**
- Create: `src/cortex/engine.js` (UMD → `NexoEngine`), `src/cortex/mind.js` (UMD → `NexoMind`)
- Create: `tests/fixtures/pcs-simulados/index.cjs` (as máquinas), `tests/cortex-engine.test.cjs`, `tests/cortex-sim.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Tasks 2–6; uma "loja" com a mesma forma de `memory.record/latest/list` (Task 1) — nos testes, uma loja em memória.
- Produces:
  - `mind = { available: () => false, proposeHypotheses: async () => [], narrate: async (step) => null }`
  - `createEngine({ store, map, act: (action) => Promise<Outcome>, ctx: () => PlannerCtx, now, onThought?: (text) => void }) ->`
    `{ open(anomaly) -> Promise<number /*inv*/>, step(inv) -> Promise<'continua'|'aguardando'|'esperando-repetir'|'concluida'>, resume() -> Promise<number[] /*invs abertas*/>, attach(anomaly) -> number|null }`
  - Regras: `open` reusa investigação aberta com mesmo `symptom` (Review Focus 3: `attach` grava `prova` nela e devolve o
    id); cada passo grava `pensamento` (via `NexoNarrate.say`), `experimento`, `prova`, `crenca` e, no fim, `conclusao`
    e eventos do mapa (`relacao`); `need` do planejador vira registro `necessidade` + `conclusao nao-resolvido`;
    `needsApproval` grava `pedido` e devolve `'aguardando'`; `resume()` reconstrói tudo só pelos registros (Review Focus 2).
  - Fixtures: `PCS = [{ name, truth: key|null, minutes(): MinuteRow[], act(action): Outcome, anomaly: Anomaly }]` com:
    `programa-noturno` (programa pesado às 21h → cpu), `calor` (temp_cpu → clock_queda), `ajuste-latencia`
    (`ajuste:` que melhora `bench:latency` de verdade, acima do ruído), `disco-cheio` (disk → travadas),
    `so-ruido` (truth `null`, tudo dentro do ruído) e `invisivel` (causa não medível: nenhum alvo separa).
- [ ] **Step 1: Write the failing tests** — `tests/cortex-engine.test.cjs`: abrir, dar passos até concluir com um `act`
  falso; reabrir a mesma lentidão anexa em vez de abrir outra; matar no meio e `resume()` num motor novo com a mesma
  loja continua do passo seguinte; `aguardando` com `pedir`; nenhum registro é sobrescrito (só cresce).
  `tests/cortex-sim.test.cjs` (critérios do spec): causa verdadeira entre as 3 primeiras hipóteses em ≥ 90% das
  máquinas com causa; `apoiada` correta em ≥ 70%; **zero** `apoiada` em `so-ruido`; `invisivel` termina em
  `nao-resolvido` com um registro `necessidade`. Rodar cada máquina com 5 sementes de ruído diferentes.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `engine.js` e `mind.js`. A semente fica fixa por máquina para os testes serem repetíveis.
- [ ] **Step 4: Rodar e ver passar** — `node --test tests/cortex-engine.test.cjs tests/cortex-sim.test.cjs`.
- [ ] **Step 5: Commit** — `git commit -m "Cortex: motor de investigação e PCs simulados"`

### Task 8: Lab como braço + Cortex no processo principal

**Files:**
- Modify: `src/lab.js` (opção `onlyKnobs` em `run` e `chooseCandidates`), `tests/lab.test.cjs`
- Create: `src/cortex/cortex.cjs`, `tests/cortex-main.test.cjs`
- Modify: `main.cjs` (criar o Cortex, IPC, tique, backup diário), `preload.cjs`, `tests/main-ipc.test.cjs`, `package.json`

**Interfaces:**
- Consumes: Tasks 1–7; `NexoLab.run(labSystem, opts)`, `labSystem.quiet()`, `labSystem.bench(mode)`,
  `NexoExperiment.summarize/compare` (o que o lab já usa para decidir "acima do ruído"), `errorLog.record`,
  `createOnceADay`, `powerMonitor.getSystemIdleTime()`.
- Produces:
  - `NexoLab.chooseCandidates({ ..., only?: string[] })` e `NexoLab.run(system, { ..., onlyKnobs?: string[] })`: com a
    lista, só esses ajustes viram braços; `combos` forçado a 0; sem a lista, comportamento idêntico ao de hoje.
  - `createCortex({ memory, labRun, bench, idle: () => boolean, busy: () => boolean, now, emit, log }) ->`
    `{ observeMinute(m), observeEvent(e), observeSession({ id, summary, samples }), tick() -> Promise<void>, settings() , setSettings({ permission, maxRisk, consent? }), approve(inv), deny(inv), list({ limit }), get(inv), stats() }`
    - `act('lembrar')` consulta `memory.minutes/events`; `act('esperar')` marca `esperando-repetir` (a próxima lentidão
      igual vira o resultado); `act('medir')` = `quiet()` + 5 rodadas de `bench(modo)` antes e depois, decide com
      `NexoExperiment`; `act('intervir')` = `labRun({ onlyKnobs: [knob], maxArms: 1, combos: 0, autonomy: 'assistido', allowRisk, consent, requireRestorePoint: risk !== 'baixo' })`
      (nunca adota; o lab já volta tudo ao original e o Diário registra).
    - Configuração em `memory.setMeta('cortex.config')` como registro `ajuste` (eterno): `permission` padrão
      `'observar'`; `'sozinho'` exige `consent === NexoLab.CONSENT_PHRASE`; com `'sozinho'` o teto de risco é
      `'baixo'`; com `'pedir'` vale o `maxRisk` escolhido.
    - `tick()` (a cada 60 s, `setInterval(...).unref()`): não faz nada se `busy()` (lab, análise profunda, teste com
      reinício ou benchmark rodando); dá no máximo 1 passo por investigação aberta; roda `mineCorrelations` 1×/dia
      sobre os últimos 14 dias e abre investigação `curiosidade` para cada relação nova; `memory.backupDaily()` e
      `memory.camera.prune()` 1×/dia.
    - O que abre investigação: `observeEvent` de `lentidao` (sintoma pelo `kind` do episódio: `cpu→cpu`,
      `memory→mem`, `thermal→temp`, `throttle→clock_queda`); `observeSession` com achado (gargalo do `NexoBottleneck`:
      `gpu*→gpu`, `gpu-calor`/`cpu-calor→temp`, `cpu-thread`/`cpu-total→cpu`, `memoria→mem`; travadas→`travadas`;
      `limite-de-quadros` e `equilibrado` **não** abrem); `curiosidade` das correlações novas. Um evento `lab` não abre
      investigação: cada braço medido vira evento do mapa (`experimento-a-favor`/`-contra` na aresta
      `ajuste:<knob>→bench:<b>`), e um resultado que contradiz uma relação `apoiada` reabre a conclusão dela.
    - Memória da máquina e marcos: na abertura, `memory.addMachine(await getSystemSnapshot())` (o mesmo do canal
      `system:snapshot`; só grava se mudou); se `app.getVersion()` ≠ `memory.getMeta('versao')`, evento
      `atualizacao-nexo`; o handler `drivers:install` grava evento `driver` (id e versão, sem caminhos).
    - Qualquer exceção: `log({ source: 'cortex', level: 'erro', message, context: { etapa } })` e segue; se a memória
      não abrir, `createCortex` devolve um Cortex "desligado" (todos os métodos são no-op e `stats().ativo === false`).
  - IPC (via `registerIpcHandler`): `cortex:minute`, `cortex:event`, `cortex:session`, `cortex:import-legacy`,
    `cortex:list`, `cortex:get`, `cortex:stats`, `cortex:settings`, `cortex:set-settings`, `cortex:approve`,
    `cortex:deny`; empurra `cortex:update` com `sendToWindow` quando uma investigação muda.
  - `preload.cjs` (`nexoDesktop`): `cortexMinute, cortexEvent, cortexSession, cortexImportLegacy, cortexList, cortexGet, cortexStats, cortexSettings, cortexSetSettings, cortexApprove, cortexDeny, onCortexUpdate`.
- [ ] **Step 1: Write the failing tests:** `lab.test.cjs` — `chooseCandidates({ only: ['perfepp'] })` só devolve
  `perfepp`; `run` com `onlyKnobs` testa 1 braço e 0 combinações; os testes antigos do lab continuam iguais.
  `cortex-main.test.cjs` (memória em pasta temporária, `labRun`/`bench` falsos): minuto e lentidão entram na memória;
  com `permission:'observar'` nenhum `labRun`; `'sozinho'` sem a frase é recusado; `busy()` verdadeiro → `tick` não age;
  `idle()` falso → nenhum `bench`/`labRun` (Review Focus 4); sessão com achado `cpu-thread` abre investigação de `cpu`
  e sessão `equilibrado` não abre; evento `lab` não abre investigação e grava evento de relação; memória que não abre → Cortex desligado e um `log` com
  `source:'cortex'` (Review Focus 1). `main-ipc.test.cjs` — os 11 canais existem e `cortex:stats` responde.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** (em `main.cjs`: criar a memória em `path.join(app.getPath('userData'), 'cortex')` depois de
  `app.whenReady`; `busy` usa `labState.running`, `activeBench`, `deepAnalysis.isRunning()` e `rebootTest.active()`;
  `idle` = `powerMonitor.getSystemIdleTime() >= 600`).
- [ ] **Step 4: Rodar e ver passar** — `npm test`.
- [ ] **Step 5: Commit** — `git commit -m "Cortex: processo principal, IPC e lab como braço"`

### Task 9: Alimentar o Cortex pela interface

**Files:**
- Modify: `src/brain.js` (`create(saved, { onEpisode })`), `tests/brain.test.cjs`
- Modify: `src/store.js` (mandar minuto e lentidão; importar o legado 1 vez), `src/view-sessions.js` (mandar a sessão),
  `src/view-lab.js` (mandar o resultado do lab), `dev/mock-bridge.js` (versões falsas dos métodos novos)

**Interfaces:**
- Consumes: métodos do `nexoDesktop` da Task 8.
- Produces: `NexoBrain.create(saved, { onEpisode?: (episode) => void })` — chamado em `closeEpisode` com o episódio
  fechado (mesma forma que já vai para `state.episodes`).
- [ ] **Step 1: Write the failing test** em `tests/brain.test.cjs`: 4 minutos com CPU ≥ 85 e depois 3 normais chamam
  `onEpisode` uma vez com `kind:'cpu'`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar:** `store.js` cria o cérebro com `onEpisode: (e) => bridge.cortexEvent({ kind: 'lentidao', at: e.end, data: e })`,
  manda `bridge.cortexMinute(...)` com a mesma amostra do `brain.ingest` e, na primeira vez (flag
  `Nexo.keys.cortexImported` no armazenamento local), `bridge.cortexImportLegacy({ history, brain: brain.serialize() })`.
  `view-sessions.js`, logo depois de `NexoSession.analyze`, chama
  `bridge.cortexSession({ id: finished.id, summary: { game: report.game?.name || null, meta: report.meta, findings: report.findings }, samples: finished.samples })`.
  `view-lab.js`, ao terminar, `bridge.cortexEvent({ kind: 'lab', at: Date.now(), data: { arms, verdict, goal } })`.
  Todas as chamadas dentro de `try` e sem `await` bloqueando a tela; sem bridge (navegador/preview), nada acontece.
- [ ] **Step 4: Rodar e ver passar** — `npm test` (inclui `syntax.test.cjs` e `security-static.test.cjs`).
- [ ] **Step 5: Commit** — `git commit -m "Cortex: interface alimenta a memória e as investigações"`

### Task 10: Caderno do Cortex (interface)

**Files:**
- Modify: `index.html` (seção nova dentro de `data-view-panel="analysis"`, script `src/view-cortex.js` e os módulos
  `src/cortex/relations.js`, `src/cortex/narrate.js` para rótulos), `style.css`
- Create: `src/view-cortex.js`
- Modify: `dev/mock-bridge.js` (2 investigações de exemplo: uma `apoiada`, uma `aguardando`)

**Interfaces:**
- Consumes: `nexoDesktop.cortexList/cortexGet/cortexStats/cortexSettings/cortexSetSettings/cortexApprove/cortexDeny/onCortexUpdate`.
- Produces: seção "Caderno do Cortex" com:
  - topo: estado (ativo/desligado), memória ocupada (MB), dias de memória, relações provadas nesta máquina;
  - chave de permissão `Só observar` (padrão) / `Pedir antes de testar ajustes` (+ teto de risco) /
    `Testar ajustes sozinho com o PC parado` (pede a frase `ENTENDO O RISCO`, teto baixo);
  - lista de investigações por estado (abertas, aguardando você, concluídas, não resolvidas); ao abrir: pergunta,
    hipóteses com estado e barra de confiança, testes feitos, provas (com o trecho guardado) e a linha do tempo dos
    pensamentos; botões `Pode testar` / `Agora não` quando `aguardando`;
  - "Instrumentos que faltaram" (registros `necessidade`).
  - Visual no padrão do Nexo (vidro/aurora, neon, toque de fantasia sombria). Sem "provavelmente" em nenhum texto.
- [ ] **Step 1: Rodar o preview** — `npm run preview` e abrir a página gerada; seção ainda não existe.
- [ ] **Step 2: Implementar** a seção, o `view-cortex.js` (IIFE como as outras `view-*.js`, usando `escapeHtml` para tudo
  que vem da memória) e o estilo.
- [ ] **Step 3: Verificar** — `npm run preview` gera sem erro; com o mock, as 2 investigações aparecem, os botões
  chamam os métodos falsos e a chave de permissão pede a frase; `npm test` passa (`syntax`, `security-static`).
- [ ] **Step 4: Commit** — `git commit -m "Cortex: Caderno na página de Análise"`

### Task 11: Privacidade, exportação e anotação para a release

**Files:**
- Modify: `PRIVACIDADE.md`, `PRIVACY.md`, `src/view-settings.js` (exportar inclui uma cópia da memória; texto do botão
  "Apagar aprendizado e histórico" avisa que a memória do Cortex fica), `index.html` (texto da seção de privacidade),
  `main.cjs` (`cortex:export` → `memory.backup` para a pasta escolhida em `dialog.showSaveDialog`), `preload.cjs`
- Project doc: `claude/pendente-proxima-versao.md`

**Interfaces:**
- Consumes: Task 1 (`backup`), Task 8.
- Produces: canal `cortex:export` → `{ ok, file }`; método `cortexExport()` no `nexoDesktop`.
- [ ] **Step 1: Write the failing test** em `tests/main-ipc.test.cjs`: `cortex:export` com `dialog` falso devolve um
  arquivo que abre com `DatabaseSync` e tem as mesmas contagens de `registros`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** o canal e os textos. Política (PT e EN): a memória do Cortex fica **só neste PC**, para
  sempre, não é enviada a lugar nenhum e não tem botão para apagar; o "Apagar aprendizado" apaga só o aprendizado antigo;
  a pessoa pode exportar uma cópia.
- [ ] **Step 4: Rodar e ver passar** — `npm test`.
- [ ] **Step 5: Anotar** em `claude/pendente-proxima-versao.md` (doc do projeto; ler, acrescentar uma seção "Cérebro:
  Cortex v0 e memória eterna" com o que a pessoa vê, e gravar de volta). **Nada de CHANGELOG.**
- [ ] **Step 6: Commit** — `git commit -m "Cortex: privacidade, exportação da memória"`
