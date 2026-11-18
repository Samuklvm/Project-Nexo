# Drivers: o resto do projeto 2 e os projetos 3, 4 e 5 (plano de execução)

> O Samuel pediu (18/11/2026) para fazer todas as partes combinadas sem parar, corrigir os bugs de cada uma até os
> mínimos detalhes e subir para a `main`. Ele abriu mão das perguntas: as decisões abaixo são minhas e ficam anotadas
> no ledger (`.superpowers/sdd/2026-11-18-drivers-tudo/progress.md`) como `Ruling:`.

**Regras que valem para tudo** (do Samuel e do repositório):
- Driver só do site oficial de quem fez; **Windows Update: nunca**; vídeo sempre pelo fabricante do chip.
- O app **sabe ou não sabe**: nada de chute ("provavelmente"). Sem informação, diz que não dá para saber daqui.
- Nada silencioso: o instalador oficial abre na frente da pessoa. Ponto de restauração pela chave do topo.
- Domínios e assinantes fixos no código; `style=` embutido proibido; loop infinito de CSS só o `shimmer`; sem regex com
  retrocesso; interface em português, bonita e na paleta do app.
- Sem CHANGELOG/release aqui; a novidade vai para `claude/pendente-proxima-versao.md`.

## Parte 2 — fabricantes de peça
- **Intel:** botão Baixar do **Intel Driver & Support Assistant** (`https://dsadata.intel.com/installer`, redireciona
  para `downloadmirror.intel.com`; assinante `Intel Corporation`) nos cartões Intel sem pacote do fabricante do PC
  (vídeo Intel de desktop, Wi-Fi/Bluetooth/LAN Intel, chipset Intel).
- **AMD:** sem link estável e público (o site exige navegador); continua o botão do site oficial. Ruling.
- **Periféricos:** peça USB da Logitech (VID 046D), Razer (1532), Corsair (1B1C) ou SteelSeries (1038) → cartão do
  programa oficial no grupo "Todos os outros": instalado = "Em dia" (eles se atualizam sozinhos); não instalado =
  "Confira" com Baixar (Logitech G HUB em `download01.logi.com`, SteelSeries GG em `steelseries.com`) ou o site (Razer
  Synapse e Corsair iCUE, sem link estável confirmado).
- **Runtimes antigos:** Visual C++ 2005/2008/2010/2012/2013 que faltam viram cartões compactos com Baixar do link
  oficial da Microsoft (32 bits, que é o que os jogos antigos usam).

## Parte 3 — Catálogo da Microsoft (último recurso)
- Só para peça **sem driver** e **sem fabricante identificável** (fabricante desconhecido e sem pacote do PC).
- Busca pelo código de hardware em `catalog.update.microsoft.com` (HTML), escolhe o driver de data mais nova para
  Windows 10/11 x64 e baixa o `.cab` de `catalog.s.download.windowsupdate.com` (Microsoft Update Catalog, não o Windows
  Update). Instala pelo pnputil só com `.cat` assinado. Em segundo plano, com cache de 24 h.

## Parte 4 — "Atualizar tudo" e backup
- **Backup:** `pnputil /export-driver *` (elevado) numa pasta `Documentos\Nexo\Backup de drivers\AAAA-MM-DD HHhMM`;
  lista dos backups com "Abrir pasta" e "Restaurar" (`pnputil /add-driver <pasta>\*.inf /subdirs /install`).
- **Atualizar tudo:** um botão no topo com o número de atualizações conhecidas. Baixa tudo (fila de 4) e instala um por
  vez na ordem certa: chipset/placa → armazenamento → rede → áudio → Bluetooth → outros → runtimes → vídeo por último.
  Ponto de restauração só antes do primeiro (se a chave estiver ligada).

## Projeto 3 — inteligência
- **Bom para os seus jogos:** a NVIDIA diz nas notas do driver para quais jogos ele é "Game Ready". O Nexo cruza com a
  biblioteca de jogos e mostra no cartão de vídeo "Game Ready para X e Y, que você tem instalados".
- **Histórico com comemoração:** o app guarda as versões de cada driver a cada leitura; quando uma versão sobe, o cartão
  comemora (brilho que passa uma vez) e mostra a linha do tempo ("566.14 → 621.14 em 18/11").

## Projeto 4 — usabilidade
- Filtro "Só o que precisa de atenção", busca por nome, chips por grupo (com contagem, levam ao grupo), ordem guiada
  dentro de cada grupo (atualização → falta → erro → confira → em dia) e bolinha no item "Drivers" da barra lateral
  quando há atualização conhecida.

## Projeto 5 — constelação dos drivers
- No topo, um céu em SVG: cada driver é uma estrela, cada grupo é uma constelação; a cor diz o estado (sabe: em dia,
  atualização, falta; não sabe: estrela apagada). Passar o mouse mostra o nome; clicar leva ao cartão. Brilho que passa
  uma vez quando a leitura chega (sem loop infinito).

## Fechamento
- `npm test` 3 vezes, prévia com capturas, revisão final independente, correção de tudo que for achado, doc pendente,
  merge na `main`.
