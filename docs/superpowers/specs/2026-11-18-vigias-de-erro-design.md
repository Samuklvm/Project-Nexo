# Vigias de erro (projeto 3 de 5 do servidor)

**Pedido do Samuel:** "fazer o app avisar cada mínimo errinho (ou coisa funcionando de forma meio estranha) pra gente."
Entra na 0.11.4, junto com a contagem e os drivers ("bora incluir a fase 3 também"). O Samuel foi dormir e deixou
mexer à vontade: as decisões abaixo são do Claude e estão marcadas em **Decisões tomadas pelo Claude**.

## Como está hoje (0.11.3)

- O app já registra **erros** e **avisos** num registro local (`electron/error-log.cjs`), com assinatura, agrupamento,
  limite de 20 por hora por assinatura e trilha dos últimos passos (só nos erros).
- A interface (`src/core.js`, `watchErrors`) já pega: erro e promessa sem tratamento, `console.error`/`console.warn`,
  arquivo do app que não carregou, violação de CSP, tela travada (tarefa longa ≥ 2 s) e memória da tela ≥ 85% do limite.
- O processo principal já pega: ação lenta, laço travado, janela sem responder, processos que caíram, comandos do
  Windows que passaram do prazo, interrupções.
- **Mas só os erros saem do PC.** `cloud.sendErrors` manda `levels: ['erro']`. Os avisos (justamente o "funcionando
  de forma estranha") ficam só no registro local, e o servidor e o Claude nunca veem.
- O servidor já aceita `level: 'aviso'` e o conector já tem `incluir_avisos`. O alarme de regressão usa só erros.

## Objetivos

1. **Os avisos vão para o servidor** junto com os erros, pelo mesmo interruptor "Relatórios de erro" (ligado por
   padrão, desligável). Com a trilha também.
2. **Vigias novos** para coisas que funcionam, mas errado (sem exceção nenhuma):

   | Vigia (`context.vigia`) | Onde | Dispara quando | Uma vez por |
   |---|---|---|---|
   | `leitura-impossivel` | interface (`store.js`, a cada leitura) | CPU, memória, disco ou vídeo fora de 0–100 % ou `NaN` onde vinha número; temperatura fora de −10 a 125 °C; memória total 0 | campo, por abertura |
   | `sensores-sumiram` | interface | as temperaturas funcionavam nesta abertura e ficaram sem valor por 5 min seguidos | abertura |
   | `fonte-falhando` | interface (`features.js`) | a mesma fonte de dados dos cartões falhou 3 vezes seguidas, ou demorou mais de 20 s | fonte, por abertura |
   | `abertura-lenta` | interface | a primeira leitura do PC chegou mais de 12 s depois de a tela abrir | abertura |
   | `ceu-lento` | interface | com o Nexo em foco, efeitos completos e a tela inicial aberta, o céu ficou abaixo de 12 quadros/s por 1 min | abertura |
   | `memoria-alta` | principal (`app.getAppMetrics`) | todos os processos do Nexo somados passaram de 1,5 GB (conferido a cada 10 min) | abertura |
   | `contagem-recusada` | principal (`cloud.sendPulse`) | o servidor recusou o sinal de vida com 4xx (não conta sem rede, 429 nem 5xx) | abertura |

   Os avisos que já existiam ganham também um nome de vigia (`tela-travada`, `memoria-da-tela`, `arquivo-nao-carregou`,
   `console-aviso`, `acao-lenta`, `processo-travado`, `janela-sem-resposta`), para o painel juntar por tipo.
3. **Servidor, painel e conector enxergam os vigias:**
   - o resumo do conector (`nexo_resumo`) ganha `avisosAbertos`;
   - ferramenta nova **`nexo_vigias`**: por vigia, nos últimos N dias (padrão 7): quantos grupos, PCs (instalações),
     ocorrências, versões e o aviso mais comum;
   - no painel, aba Erros: um cartão **"Vigias"** com a mesma tabela, e a lista de erros com a opção de mostrar os
     avisos (já existe no conector; no painel, um botão).
   - o alarme de regressão e o "% sem erro" continuam só com erros (avisos não contam como erro).

## Fora deste projeto

- Interruptor remoto e alerta no Discord (projeto 4). Sincronização automática (projeto 5).
- Mudar a telemetria (os vigias não entram nela).
- Reagir sozinho a um aviso (o app só avisa; quem corrige é o criador).

## O que não pode acontecer

- **Inundar o servidor ou o painel:** um aviso em loop não pode virar milhares de linhas. Limites: uma vez por abertura
  em cada vigia novo; o registro já limita 20 por hora por assinatura; o envio continua em lotes de 50 grupos.
- **Mandar os avisos velhos** guardados no registro antes da atualização: só saem os avisos registrados **depois** que
  a versão nova abriu (janela própria dos avisos, `avisosWindowAt`).
- **Sair algo pessoal:** os vigias só mandam números arredondados, nomes fixos de campos, de fontes e de telas. Nada
  de nomes de programas, pastas, usuário ou texto digitado. O registro continua limpando caminhos, usuário e e-mails.
- **Avisos virarem "regressão"** ou derrubarem o "% sem erro" da versão.
- Um vigia derrubar a tela ou o processo principal (todo vigia roda dentro de `try`).
- Quebrar a 0.11.3 publicada: o servidor continua aceitando os relatórios antigos.
- Sair do plano grátis da Cloudflare.

## Como funciona

### Envio dos avisos (`electron/cloud.cjs`, `electron/error-log.cjs`)

- `groupsSince` ganha `since: { [nível]: instante }`: uma entrada de um nível com `since` só entra se for desse
  instante em diante (o `notBefore` geral continua valendo para todos).
- `cloud.load`: sem `avisosWindowAt` (primeira abertura da versão nova), grava `avisosWindowAt = agora`. Religar os
  relatórios atualiza `errorsWindowAt` **e** `avisosWindowAt` (nada do tempo desligado sai).
- `sendErrors` manda `levels: ['erro', 'aviso']` com `since: { aviso: avisosWindowAt }`. Como as entradas andam pela
  sequência do registro, o cursor cobre os dois níveis e nada fica para trás.
- A trilha (`main.cjs`, `errorLog.record`) passa a ir também nos avisos.

### Vigias da interface (`src/watchers.js`, novo, carregado depois de `core.js`)

- Um módulo só, `Nexo.watchers`, com `note(vigia, mensagem, contexto)` que manda um aviso pela mesma ponte
  (`desktopBridge.reportError`) com `context.vigia` e marca "já avisado nesta abertura" por chave.
- As funções que decidem são puras e exportadas (para os testes): `checkReading(snapshot, sample)` devolve a lista de
  problemas de uma leitura; `sensorsGone(state, sample, now)`; `slowStart(ms)`; `skySlow(state, fps, now, on)`.
- `features.js` chama `Nexo.watchers?.sourceResult(nome, ok, ms, mensagem)` em cada resultado de fonte.

### Vigias do processo principal (`main.cjs`)

- `memoria-alta`: a cada 10 min soma `workingSetSize` de `app.getAppMetrics()`; passou de 1,5 GB, um aviso com o total
  e as partes por tipo (Browser, Renderer, GPU…), em MB arredondados.
- `contagem-recusada`: `sendPulse` devolve `{ failed, status }`; o main registra o aviso quando o status é 4xx (≠ 429).

### Servidor (`server/`)

- `SOURCES` ganha `vigia`? **Não**: os vigias usam as origens que já existem (`interface`, `principal`), e o tipo vai em
  `context.vigia`. Assim a 0.11.3 e o servidor atual continuam compatíveis sem mudar a validação.
- `vigias(env, dias)` em `server/src/vigias.js`: lê `error_groups` com `level = 'aviso'` e `last_at` no período, junta
  por `json_extract(context, '$.vigia')` (sem vigia = `outro`), com PCs e ocorrências de `error_reports`.
- `GET /admin/vigias` (painel) e a ferramenta `nexo_vigias` (conector), só leitura, sem e-mails.
- `nexo_resumo` ganha `avisosAbertos`.

### Privacidade e textos

- `PRIVACIDADE.md` / `PRIVACY.md`: os relatórios de erro passam a levar os avisos, com a lista do que os vigias olham
  (só números arredondados e nomes fixos).
- Ajustes (`index.html`, "Relatórios de erro"), o texto da política em `view-cloud.js`, `PRIVACY_DETAILS` do NSIS
  (PT/EN) e o instalador visual: "os erros e os avisos do app".

## Testes

- `tests/error-log.test.cjs` (ou o arquivo de registro que já existe): `groupsSince` com `since` por nível.
- `tests/cloud.test.cjs`: avisos novos vão; avisos de antes da atualização não vão; religar não manda os do tempo
  desligado; um lote com erros e avisos misturados não perde nada.
- `tests/watchers.test.cjs`: cada função pura com valores no limite (100 %, 101 %, −10 °C, 125 °C, `NaN`, sensor que
  some por 4 e por 5 min, abertura de 12 s e 12,1 s, céu lento com e sem foco); `note` não repete na mesma abertura.
- `tests/server-vigias.test.cjs`: agrupamento por vigia, período, sem e-mail nas respostas, `nexo_vigias` no conector,
  `avisosAbertos` no resumo, aviso não vira regressão.
- Privacidade: os textos novos citam os avisos (teste de texto, como os que já existem).

## Decisões tomadas pelo Claude (o Samuel pode corrigir)

1. **Os avisos vão pelo mesmo interruptor dos relatórios de erro** (ligado por padrão), em vez de um interruptor novo.
   É o que o Samuel pediu ("avisar cada mínimo errinho"), e um interruptor a mais confunde. Custo se errado: quem
   quisesse mandar erros e não avisos não consegue separar.
2. **Sem origem nova no servidor** (`vigia` vai no contexto): mantém a compatibilidade e não exige deploy antes do app.
3. **Limites dos vigias** (12 s de abertura, 1,5 GB, 12 quadros/s, 5 min sem sensor, 3 falhas seguidas): escolhidos
   com a telemetria atual (abertura p90 14,8 s; memória p90 ~0,9 GB; céu mediano 25 quadros/s). Dá para ajustar depois
   de ver os primeiros dias pelo `nexo_vigias`.
4. **Uma vez por abertura** em cada vigia novo, para não inundar. Custo: um problema que volta várias vezes na mesma
   abertura aparece como uma ocorrência só.
