# Cortex v0 + Memória eterna (parte 1 de 6 do cérebro do Nexo)

**Pedido do Samuel:** um Nexo que entenda o PC "como uma IA", e não um app de avisos e ajustes manjados. Ele deve
criar os próprios testes e métodos, desconfiar das próprias conclusões, não aceitar "chegou no limite físico" sem
provar, e melhorar o próprio jeito de aprender. A inspiração é o Mahoraga: adaptação, não força bruta.
A visão foi construída numa conversa com o ChatGPT (19/11/2026) e as decisões de lá valem como decididas aqui.

**Ordem das 6 partes (decidida):** 1. Memória eterna + Cortex v0 → 2. Oficina de ferramentas (o Nexo inventa
instrumentos, com sandbox e núcleo de segurança) → 3. IA local opcional → 4. Arena de evolução → 5. Constelação
(Nexos conversando) → 6. Vila. Este documento cobre só a parte 1.

## Por que esta parte vem primeiro

Hoje o `brain.js` **observa** (rotina em 168 faixas, lentidões, culpados) e o `lab.js` **testa** (espaço fechado e
reversível, UCB, A/B contra o ruído, tabu, volta tudo no fim), mas **um não conversa com o outro**: nenhum dos dois
levanta hipóteses, escolhe o teste que separa explicações ou guarda uma conclusão. E o Nexo **esquece de propósito**:
7 dias de histórico (`store.js`), no máximo 120 lentidões por 30 dias e 60 culpados (`brain.js`), tudo no
armazenamento do navegador. Sem memória permanente e sem ciclo de investigação, as partes 2 a 6 não têm onde se apoiar.

## Marco de pronto (o mesmo combinado com o ChatGPT)

A partir de uma anomalia real (uma lentidão, uma sessão de jogo com travadas, um resultado surpreendente do lab), o
Nexo, **sem IA nenhuma**:

1. formula **pelo menos 3 hipóteses concorrentes**, sempre incluindo "causa que eu ainda não sei medir";
2. escolhe a medição ou o teste que **mais separa** as hipóteses (ganho de informação ÷ custo);
3. executa (olhando a memória, esperando a repetição, rodando um teste do lab ou um ajuste do lab);
4. guarda uma **conclusão reaproveitável** com estado honesto: suspeita, correlacionada, apoiada ou derrubada;
5. diz **"não achei"** quando não achou, e registra o que faltou medir.

As hipóteses **não** podem estar escritas como uma lista fixa de respostas por sintoma.

## Objetivos

1. **Memória eterna** no alcance que o Samuel escolheu (opção A, 24/11/2026): fica para sempre, intacto, tudo que o
   Nexo pensou, testou, concluiu e conversou, mais as medições por minuto. Do quadro a quadro dos jogos e dos rastros
   pesados ficam para sempre os **resumos** e os **trechos exatos que serviram de prova** de alguma conclusão.
2. **Cortex v0** com **ritmo leve e profundo**: o ciclo anomalia → hipóteses → plano → execução → atualização → conclusão, rodando no processo
   principal, sem travar nada.
3. **Mapa de relações do PC** que o Cortex usa para pensar e que **aprende**: confirma, derruba e cria relações novas
   a partir dos dados desta máquina.
4. **Pensamento registrado**: cada passo do Cortex vira uma frase em português simples, guardada para sempre.
5. **Página do Cortex** na interface (página própria na barra lateral): investigações em andamento e concluídas, com hipóteses, testes, provas e
   conclusão.
6. **Lugar reservado para a IA local** (parte 3): uma interface definida e vazia, que o Cortex consulta se existir.
7. **Banco de PCs simulados** nos testes automáticos, para medir se o Cortex acerta causas conhecidas.

## Não-objetivos (ficam para as próximas partes)

- Inventar e rodar ferramentas novas (parte 2). Na v0, o Cortex só **registra a necessidade** de um instrumento
  quando não consegue separar hipóteses; isso vira a fila de entrada da Oficina.
- IA local, arena de evolução, Constelação, Vila.
- Sensores novos de baixo nível (ETW, DPC/ISR, I/O por processo). A v0 usa só o que o Nexo já mede.
- Substituir o `brain.js` ou o `store.js`. Eles continuam funcionando; o Cortex lê deles.
- **Liberdade de reestruturar (Samuel, 24/11/2026; vale para quem desenvolve, o Claude, e não vira opção para quem
  usa o app):** o construtor pode mudar a estrutura inteira do laboratório e as
  APIs internas do app (IPC, `lab.js`, `lab-system.cjs`, `preload.cjs`) se isso deixar o Cortex melhor, desde que as
  funções que a pessoa já usa continuem funcionando e os testes existentes continuem passando (ou sejam atualizados
  junto, com o mesmo rigor).

## Anti-objetivos (fracasso mesmo que "funcione")

- Afirmar melhora ou causa sem passar do ruído medido (regra de ouro do `experiment.js`).
- Usar "provavelmente" ou chutar. O Cortex diz o estado (suspeita, correlacionada, apoiada, derrubada, não sei).
- Pesar no PC: nada de raciocínio pesado durante jogo, nada de travar a interface, nada de gravação em disco a cada
  segundo no banco eterno.
- Mexer em qualquer coisa fora do espaço fechado do laboratório (na v0), ou sem a autorização que o lab já exige.
- Apagar memória, sozinho ou a pedido. Nenhuma tabela eterna tem prazo de validade e **não existe botão para apagar a
  memória eterna** (decisão do Samuel, 24/11/2026). O botão "Apagar aprendizado" que já existe continua zerando **só**
  o cérebro antigo (`brain.js` e histórico de 7 dias no armazenamento local).
- Hipóteses de enfeite: cada uma tem previsões testáveis, senão não entra.

## Restrições

- Electron 45 (Node 24 no processo principal). Interface com `sandbox: true` e `contextIsolation`: o Cortex e o banco moram no **processo
  principal**; a interface fala com ele por IPC (`registerIpcHandler`, como o resto do app).
- Banco: **SQLite embutido do Node (`node:sqlite`)**, sem módulo nativo novo. **Verificado em 24/11/2026:** o Electron 45.2.3
  traz o Node 24.22 com `DatabaseSync` e `backup`; o Node 22 dos testes também.
- Grátis e local: nada sai do PC nesta parte (a Constelação, na parte 5, é que decide o que compartilhar).
- App sem assinatura: a v0 não cria executáveis, scripts nem processos novos.
- Windows e Linux (o lab já tem espaço próprio para Linux).
- Testes no padrão do repositório: `node --test tests/*.test.cjs`, módulos UMD puros testáveis fora do Electron.

## Jeitos considerados

| Jeito | O que é | Ganha | Perde |
|---|---|---|---|
| **A) Cortex por cima do que existe** ✅ | `src/cortex/` com memória SQLite, forjador de hipóteses, planejador; o `lab.js` vira o braço | Entrega o marco logo, reaproveita tudo que funciona | O mapa de relações começa com uma semente escrita por nós (o Cortex aprende a confirmar, derrubar e criar relações, mas não nasce do zero) |
| B) Arena primeiro | Simulador de PCs e provas secretas antes do Cortex | Impossível o cérebro "se achar" | Semanas sem nada novo no app |
| C) Oficina primeiro | Começar pelas ferramentas inventadas | A parte mais "uau" | Sem cérebro, ninguém pede ferramenta; é a parte que mais chama atenção de antivírus, o pior começo para um app sem assinatura |

**Escolhido pelo Samuel: A**, com um pedaço do B dentro dela (PCs simulados nos testes automáticos).

## Como funciona

### Peças

```
src/cortex/
  memory.cjs      memória eterna (só processo principal; SQLite)
  relations.js    mapa de relações do PC: semente + o que esta máquina provou
  forge.js        forjador de hipóteses (puro)
  planner.js      planejador por ganho de informação (puro)
  beliefs.js      atualização de crença e regras de conclusão (puro)
  narrate.js      transforma cada passo em frase em português (puro, sem IA)
  cortex.cjs      o ciclo: recebe anomalias, investiga, chama o lab, grava tudo
  mind.js         lugar reservado da IA local: interface vazia (parte 3)
  rhythm.js       ritmo leve/profundo (puro)
src/view-cortex.js  página do Cortex (interface)
tests/cortex-*.test.cjs + tests/fixtures/pcs-simulados/
```

### 0. Ritmo do Cortex: leve e profundo (pedido do Samuel, 24/11/2026)

O Cortex nunca para, mas muda de ritmo conforme a pessoa está ou não usando o PC.

- **Ritmo leve** (a pessoa está usando o PC, jogando etc.): **coleta e pensa de forma reduzida**. Continua gravando os
  minutos e as lentidões na memória (em lotes maiores, para gravar no disco o mínimo), abre investigações, forja
  hipóteses, consulta a memória com consultas pequenas e escreve os pensamentos. Não roda nada pesado: nada de testes
  do lab, nada de ajustes, nada de busca de correlações, nada de cópia de segurança.
- **Ritmo profundo** (a pessoa está inativa há um tempo **e não há jogo aberto em primeiro plano**): faz o trabalho
  pesado: medir, intervir (conforme a chave de permissão), buscar correlações novas, cópia de segurança e limpeza da
  câmera lenta. Jogo em primeiro plano com a pessoa parada conta como "só deu uma saidinha" ou cena do jogo: fica no
  leve.
- **Entrar no profundo:** pelo menos 10 min sem teclado/mouse (`powerMonitor.getSystemIdleTime()`) **e** nenhum jogo em
  primeiro plano (o mesmo detector das sessões: `electron/probe.cjs` + `NexoSession.classifyForeground`, consultado
  só quando o PC já está parado), confirmado em duas checagens seguidas. Na bateria, não intervém.
- **Voltar na hora:** no profundo, checa a cada poucos segundos; mexeu no teclado/mouse ou apareceu jogo em primeiro
  plano → volta ao leve **imediatamente** e cancela a ação em andamento (o lab já devolve tudo ao original quando
  cancela). Um teste interrompido não vale como resultado: fica registrado como "interrompido" e é refeito depois.
- O ritmo atual aparece na página do Cortex.

### 1. Memória eterna (`memory.cjs`)

- Arquivo `memoria.db` na pasta de dados do Nexo (`app.getPath('userData')/cortex/`), em modo WAL.
- **Só acréscimo** nas tabelas eternas: nada é sobrescrito; uma mudança de estado vira uma linha nova que aponta para
  a anterior. Assim dá para responder "o que o Nexo achava disso em março?".
- Tabelas eternas (nomes indicativos; o detalhe fica para o plano):
  - `minutos`: a amostra por minuto que o `store.js` já monta (cpu, memória, disco, gpu, temperaturas, clock, culpado).
    Uns 30 MB por ano.
  - `maquina`: retratos do hardware, drivers e sistema ao longo do tempo (para saber "o que mudou").
  - `eventos`: lentidões fechadas pelo `brain.js`, resumos de sessões (`NexoSession`/`bottleneck`), resultados do lab,
    instalações de driver, atualizações do Nexo e do Windows que o app já detecta.
  - `investigacoes`, `hipoteses`, `crencas` (histórico de confiança de cada hipótese), `experimentos`, `provas`,
    `conclusoes`, `relacoes` (arestas do mapa com contagens por máquina), `pensamentos` (o diário do raciocínio),
    `necessidades` (instrumentos que faltaram; fila da Oficina).
  - `trechos`: cópia exata dos dados crus que uma prova citou (as amostras de 1 s ou os quadros daquele intervalo).
- **Câmera lenta** (não eterna): as amostras de 1 s das sessões e o quadro a quadro ficam num depósito circular de
  alguns dias. Antes de sair do depósito, viram resumo eterno; qualquer trecho citado por uma prova já foi copiado
  para `trechos`. Tamanho do depósito: escolha do construtor, com teto em MB.
- Gravação em lote (fila em memória, uma transação a cada poucos segundos), para não pesar.
- **Cópia de segurança**: uma cópia diária do banco (API de backup do SQLite), guardando as 3 últimas, para um
  arquivo corrompido não apagar a memória.
- **Migração na primeira abertura:** importar os 7 dias de histórico e o estado do `brain.js` que estão no armazenamento
  local, marcados como "importado". Depois disso o `store.js` também manda cada minuto para o banco.
- A tela mostra quanto a memória ocupa.
- **Lembrar** (`recall`): consultas estruturadas (por sintoma, componente, período, programa, relação). É por aqui que
  a IA local da parte 3 vai ler a memória; trocar de modelo não perde nada, porque a memória é do Nexo, não do modelo.

### 2. Mapa de relações (`relations.js`)

- Um grafo de **sinais** (cpu, clock, temperatura da CPU, memória, faltas de página, disco, GPU ocupada, quadros
  ruins, ajustes do lab, programas, drivers, eventos) ligados por relações do tipo "A pode causar B",
  "A pode explicar B", "o ajuste K afeta o teste T".
- **Semente**: relações gerais e conhecidas de PC (calor → queda de clock; programa pesado → CPU alta; memória cheia →
  faltas de página → travadas; e o campo `affects` de cada ajuste do `lab-space.js`). A semente diz o que **pode**
  existir, nunca o que existe nesta máquina.
- Cada relação tem, **por máquina**, uma escada de estado: semente → observada → correlacionada → suspeita →
  apoiada por experimento | derrubada. Só experimento leva a "apoiada"; correlação sozinha nunca vira explicação.
- **Relações novas, fora da semente**: o Cortex procura, nos minutos e eventos guardados, sinais que andam juntos (com
  atraso de 0 a alguns minutos) e que nenhuma relação conhecida explica. Isso vira uma relação "correlacionada" nova,
  que entra como hipótese candidata. É assim que ele passa a pensar coisas que nós não escrevemos.

### 3. Forjador de hipóteses (`forge.js`)

- **Entradas que abrem uma investigação:** uma lentidão fechada pelo `brain.js`; um achado de sessão (travadas,
  gargalo); um resultado do lab fora do esperado; ou **curiosidade**: um padrão sem explicação (desvio grande da rotina
  ou uma correlação nova), mesmo sem incomodar ninguém.
- **Saída:** no mínimo 3 hipóteses concorrentes, cada uma com **previsões** ("se for H, então a medição M mostra Z").
  Vêm de três fontes: o caminho de volta no mapa (do sintoma às causas possíveis), as relações novas correlacionadas
  e a hipótese fixa **"causa fora do que eu consigo medir hoje"**.
- A confiança inicial vem do peso da semente, ajustado pelo histórico desta máquina (o que já foi apoiado ou derrubado
  aqui).

### 4. Planejador (`planner.js`)

- Ações possíveis, da mais barata para a mais cara:
  1. **olhar a memória** (grátis): o padrão já aconteceu antes? com que outros sinais?
  2. **esperar a repetição** com gravação detalhada de 1 s (barato; não mexe em nada);
  3. **medir** com um teste do lab sem alterar nada;
  4. **intervir** com um ajuste do espaço fechado do lab, medido A/B contra o ruído.
- Escolhe a ação de maior **ganho esperado de informação ÷ custo** (tempo, risco, incômodo), respeitando: o nível de
  risco liberado na chave de permissão; medir e intervir só no ritmo profundo; um orçamento diário de testes ativos.
- Se nenhuma ação disponível separa as hipóteses que sobraram, o Cortex registra uma **necessidade de instrumento**
  ("preciso relacionar X com Y numa escala que não meço") e encerra honestamente.

### 5. Execução

- Medir e intervir passam pelo `lab.js` e pelos testes que já existem, com as mesmas guardas (temperatura, bateria,
  erros do Windows) e a mesma volta ao estado original. O lab ganha uma opção para testar **só os ajustes pedidos**
  pelo Cortex.
- **Autorização:** o Cortex tem uma chave própria na página do Cortex (o modo do lab só existe na tela do lab, não fica
  guardado): **Só observar** (padrão; olha a memória, espera repetir e mede, sem alterar nada), **Pedir antes**
  (pede na página do Cortex antes de cada ajuste, até o risco que a pessoa escolher) e **Sozinho com o PC parado** (exige a frase
  `ENTENDO O RISCO`, como o lab, e fica limitado a ajustes de risco baixo). "PC parado" = ritmo profundo (seção 0).
- Tudo que for alterado entra também no Diário de alterações (`journal.js`), como hoje.

### 6. Crença e conclusão (`beliefs.js`)

- Cada resultado atualiza a confiança das hipóteses conforme as previsões se confirmaram ou não. O ruído é sempre
  levado em conta, com as regras do `experiment.js`.
- **Concluir:** uma hipótese passa de um limiar **e** tem prova experimental → "apoiada". Uma hipótese cuja previsão
  falhou de forma clara → "derrubada". Sem prova experimental, o máximo é "correlacionada".
- **Não achei:** acabaram as ações úteis ou o orçamento → conclusão "não resolvido", listando o que foi descartado e o
  que faltou medir.
- Uma conclusão **pode ser reaberta** se dados novos a contradizerem; a anterior continua guardada.

### 7. Pensamento registrado (`narrate.js`)

- Frases em português montadas a partir dos dados estruturados, sem IA: "Notei que o clock caiu 3 vezes hoje à noite.
  Suspeito de calor, de plano de energia ou de algo que ainda não meço. O teste que mais separa calor de plano é ...,
  porque ...". Tudo vai para `pensamentos`, para sempre.
- Se a IA local existir (parte 3), ela pode reescrever as frases de um jeito mais natural, mas o dado de base continua
  sendo o estruturado.

### 8. Página do Cortex (interface)

- **Página própria na barra lateral** (pedido do Samuel, 24/11/2026): a casa da nova IA, de todas as integrações,
  funções e mecânicas dela. As próximas partes (Oficina, IA local, Arena, Constelação) também moram aqui. As outras
  páginas podem usar o Cortex (por exemplo, a Análise mostra um cartão com a investigação em andamento e leva para a
  página), mas a parte principal é esta.
- Mostra o ritmo atual (leve ou profundo) e a chave de permissão.
- Lista de investigações (abertas, aguardando autorização, concluídas, não resolvidas). Cada uma mostra a pergunta,
  as hipóteses com estado e confiança, os testes feitos, as provas (com o trecho guardado) e a linha do tempo dos
  pensamentos.
- Também mostra quanto a memória ocupa, as relações que esta máquina já provou e a fila de "instrumentos que faltaram".
- **Referência visual: o site do Nexo** (nexodevicecare.vercel.app; pedido do Samuel, 24/11/2026). A página segue a
  identidade dele, que é a mesma fantasia sombria do Santuário:
  - **Cores do site:** tinta `#0a090d` / `#13111a` / `#1c1925`, osso `#ece3cf` (apagado `#b9b0a0`), névoa `#7f8796`,
    ouro `#c9a35a` (aceso `#f0d48e`), vermelho seda `#b3202c` (aceso `#e2394a`).
  - **Letras:** Cinzel em caixa alta e espaçada nos títulos e números; Cormorant Garamond (itálico) no texto. As duas já
    vão no app (`assets/fonts`, `@font-face` "Cinzel Nexo" / "Cormorant Nexo" do `santuario.css`).
  - **Ornamentos:** cartões escuros com cantos de ouro em arabesco; divisória fina dourada com losango vermelho no meio;
    título com sobretítulo pequeno e espaçado; letra capitular vermelha; frase de destaque em itálico dourado com fio
    vermelho à esquerda; painel de números grandes em Cinzel (como "702 / 109" do site); lista lateral com
    medalhões redondos e selo "NOVO" (como o "Inventário de ferramentas").
  - **Como isso vira o Cortex** (proposta do Claude): investigações como páginas de um "diário" em cartões emoldurados;
    hipóteses com a confiança desenhada como um fio que enche; o ritmo leve/profundo como o carretel do canto do site
    (vazio no leve, girando devagar no profundo); a lista de partes do cérebro como o inventário (só a parte pronta
    aparece; nada de botão de recurso que não existe).
  - Sem imagens nem nada dos jogos de referência; fundo e efeitos desenhados como no Santuário, a 30 quadros, só com a
    página visível, parando no modo Leve e com "menos movimento".
  - O layout exato fica para o construtor.

### 9. Lugar da IA local (`mind.js`)

- Interface definida e vazia: `mind.available()`, `mind.proposeHypotheses(contexto)`, `mind.narrate(passo)`.
  Na v0, `available()` devolve `false`. O Cortex nunca depende dela.

### 10. PCs simulados (testes)

- Fixtures com máquinas inventadas cuja causa a gente conhece: programa que pesa em certas horas; calor que derruba o
  clock; ajuste do lab que melhora a latência de verdade; disco cheio; e uma máquina **só com ruído**, sem causa.
- Critérios de aceite (escolha do Claude): causa verdadeira entre as 3 primeiras hipóteses em ≥ 90% dos casos;
  conclusão "apoiada" correta em ≥ 70%; **zero** conclusões "apoiada" na máquina só com ruído; e "não resolvido" no
  caso cuja causa não é medível.

## Decisões tomadas pelo Claude (o Samuel pode mudar)

- Banco `node:sqlite` no processo principal (sem dependência nova).
- Depósito "câmera lenta" circular de alguns dias para os dados de 1 s e o quadro a quadro.
- Cópia de segurança diária, guardando as 3 últimas.
- Chave de permissão própria do Cortex (só observar / pedir antes / sozinho com o PC parado e só risco baixo), com
  "só observar" de padrão.
- Orçamento diário: no máximo 3 ações ativas (medir ou intervir) por dia.
- Falhas do próprio Cortex (banco que não abre, investigação que travou, migração que falhou) vão para o registro de
  erros que já existe (`electron/error-log.cjs`), e daí para o servidor como qualquer outro erro do app. Os dados do
  PC e da memória continuam sem sair.
- Critérios de aceite dos PCs simulados (90% / 70% / zero falso / "não resolvido").
- Ritmo profundo depois de 10 min parado e sem jogo em primeiro plano (duas checagens seguidas); na bateria, sem
  intervenções.

## Fica para o construtor

Esquema exato das tabelas, limiares de crença, tamanho da câmera lenta, valores do orçamento, fórmula exata de ganho
de informação, conteúdo da semente do mapa e o layout da página do Cortex.

## Riscos

- O lab hoje escolhe os ajustes sozinho; testar só os ajustes pedidos exige mudar a API do `lab.js`. Está liberado
  reestruturar, mas o modo atual do lab (que a pessoa usa pela tela) não pode quebrar (`tests/lab.test.cjs`).
- Correlações falsas em excesso → a escada de estados e a regra "só experimento apoia" seguram isso; os PCs
  simulados medem.
