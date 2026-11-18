# Vigias de erro — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** os avisos do app ("coisa funcionando estranho") vão para o servidor junto dos erros, com vigias novos, e o
painel e o conector enxergam por vigia.

**Architecture:** o envio usa o registro local que já existe, com uma janela própria para os avisos. Os vigias da
interface ficam num módulo novo (`src/watchers.js`, funções puras + `note`); os do processo principal ficam no
`main.cjs`. O servidor junta os avisos por `context.vigia` (`server/src/vigias.js`).

**Tech Stack:** Electron (CommonJS no principal, scripts no navegador), Cloudflare Workers + D1, `node:test`.

**Spec:** docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md

## Global Constraints

- Sem dependências npm novas.
- Vigias novos: no máximo **uma vez por abertura** por chave; tudo dentro de `try`.
- Só números arredondados e nomes fixos no contexto (nada de programas, pastas, usuário, texto digitado).
- Avisos nunca entram no alarme de regressão nem no "% sem erro".
- O servidor continua aceitando relatórios da 0.11.3 (sem origem nova: o tipo vai em `context.vigia`).
- Textos públicos em PT e EN. Nada de CHANGELOG: anotar em `claude/pendente-proxima-versao.md`.

## Review Focus

1. **Primeira abertura da versão nova com um registro cheio de avisos antigos:** nenhum aviso de antes sai (Task 1).
2. **Aviso em loop (um vigia disparando a cada leitura):** uma ocorrência por abertura, não milhares (Task 2).
3. **Leitura no limite:** 100 % e 125 °C não disparam; 100,5 % e 126 °C disparam; `null` (sem sensor) não dispara (Task 2).
4. **Contexto com dado pessoal:** nenhum vigia põe nome de programa, caminho ou texto (Task 2 e 3, teste de chaves).
5. **Painel e conector com avisos de PCs que deixaram e-mail:** nada de e-mail nas respostas de vigias (Task 4).

---

### Task 1: Avisos no envio dos relatórios

**Files:** `electron/error-log.cjs`, `electron/cloud.cjs`, `main.cjs` (trilha), `tests/error-log.test.cjs`, `tests/cloud.test.cjs`

**Interfaces:**
- Produces: `groupsSince({ ..., levels, since: { aviso?: number } })`; `state.avisosWindowAt`.

- [ ] Teste `groupsSince: since por nível` (aviso antes do `since.aviso` fica de fora; erro do mesmo instante entra; o cursor passa dos dois).
- [ ] Testes do cloud: aviso novo vai; aviso de antes da primeira abertura da versão nova não vai; religar os relatórios não manda os avisos do tempo desligado.
- [ ] Implementar `since` e `avisosWindowAt`; `sendErrors` com `levels: ['erro', 'aviso']`.
- [ ] Trilha também nos avisos (`main.cjs`), com teste estático.
- [ ] `npm test` verde; commit.

### Task 2: Vigias da interface

**Files:** `src/watchers.js` (novo), `src/core.js`, `src/store.js`, `src/features.js`, `index.html`, `tests/watchers.test.cjs` (novo), `package.json`

**Interfaces:**
- Produces: `NexoWatchers = { checkReading(snapshot) → [{ campo, valor }], sensorsGone(state, hasTemp, now) → bool, slowStart(ms) → bool, skySlow(state, { fps, focused, full, home }, now) → bool, sourceTrouble(state, nome, ok, ms) → null|{ motivo } }`; `Nexo.watchers.note(vigia, mensagem, contexto, chave?)`; `Nexo.watchers.sourceResult(nome, ok, ms, mensagem)`.

- [ ] Testes das funções puras (limites da spec) e de `note` (não repete; leva `context.vigia`; só chaves permitidas).
- [ ] Implementar `src/watchers.js` (UMD como `brain.js`).
- [ ] Ligar: `store.js` (leitura e sensores), `features.js` (fontes), primeira leitura (abertura), céu (a cada 10 s com `Nexo.sky.stats()`); avisos que já existiam em `core.js` ganham `vigia`.
- [ ] `index.html` carrega `src/watchers.js` depois de `src/core.js`; preview continua abrindo.
- [ ] `npm test` verde; commit.

### Task 3: Vigias do processo principal

**Files:** `main.cjs`, `electron/cloud.cjs`, `tests/cloud.test.cjs`, `tests/security-static.test.cjs` (ou um teste do main)

- [ ] `sendPulse` devolve `status` quando o servidor recusa; teste.
- [ ] `memoria-alta` (função pura `memoryAlarm(metrics)` exportada de um módulo pequeno, `electron/watch-main.cjs`, com teste) e `contagem-recusada`.
- [ ] Avisos que já existiam no main ganham `vigia` (`acao-lenta`, `processo-travado`, `janela-sem-resposta`).
- [ ] `npm test` verde; commit.

### Task 4: Servidor, painel e conector

**Files:** `server/src/vigias.js` (novo), `server/src/app.js`, `server/src/tools.js`, `server/src/panel.js`, `tests/server-vigias.test.cjs` (novo), `package.json`, `.github/workflows/server.yml`

**Interfaces:**
- Produces: `vigias(env, { dias, agora }) → { dias, vigias: [{ vigia, grupos, pcs, ocorrencias, versoes, exemplo }], total }`; `GET /admin/vigias?dias=`; ferramenta `nexo_vigias({ dias })`; `nexo_resumo.avisosAbertos`.

- [ ] Testes: agrupamento por vigia, período, sem vigia = `outro`, sem e-mail, ferramenta no conector, `avisosAbertos`, aviso não vira regressão.
- [ ] Implementar; cartão "Vigias" e botão "mostrar avisos" no painel (print).
- [ ] `npm test` verde; commit.

### Task 5: Privacidade, textos e pendências

**Files:** `PRIVACIDADE.md`, `PRIVACY.md`, `index.html`, `src/view-cloud.js`, `installer/installer.nsh`, `installer-launcher/index.html`, `installer-launcher/renderer.js`, `docs/SERVIDOR.md`, `claude/pendente-proxima-versao.md` (projeto)

- [ ] Teste de texto: os textos públicos citam os avisos (PT e EN).
- [ ] Atualizar os textos; `pendente-proxima-versao.md` com nota PT/EN e novidade.
- [ ] `npm test` verde; commit.
