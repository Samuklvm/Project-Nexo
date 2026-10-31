# Nexo Device Care

Aplicativo desktop para Windows que cuida do computador: mede, explica o que está pesando, aprende a rotina de uso e oferece ações reais de manutenção, sempre com prévia e confirmação. É gratuito, de código aberto e processa tudo localmente. As recomendações são heurísticas e **não prometem** aumentar o desempenho em todos os PCs.

## O que ele faz

- **Início:** Índice Nexo (0 a 100) explicado fator por fator, medições ao vivo com miniaturas, gráficos de 5 minutos a 7 dias com dica ao passar o mouse, e as principais observações do momento.
- **Análise inteligente:** compara o presente com a sua rotina e mostra a causa provável **com a evidência**. Inclui lentidões detectadas, programas que mais atrapalham, previsão de quando o disco enche, indício de queda de clock por calor, mapa da rotina por dia e hora e leitura sob demanda dos processos.
- **Otimizar:** limpeza segura por categorias (temporários antigos, relatórios de falha, relatórios de erro do Windows e, opcionalmente, Lixeira), limpeza automática opcional, troca do plano de energia do Windows e lista dos programas que iniciam com o Windows.
- **Hardware:** explorador de sensores locais (CPU, GPU, placa-mãe, memória, armazenamento, rede, bateria e mais), com busca, filtros e exportação em CSV.
- **Manutenção:** otimização de unidades e verificação de arquivos do sistema (SFC), pelas ferramentas nativas do Windows.
- **Ajustes:** papel de parede (o padrão é a arte do instalador), modo de efeitos leve, exportar ou apagar os seus dados, e desinstalação completa.
- **Paleta de comandos:** `Ctrl+K` para ir a qualquer página ou ação.

### Como o "aprendizado" funciona (sem exagero)

Não há modelo de IA. O motor (`src/brain.js`, com testes em `tests/`) faz quatro coisas simples e verificáveis:

1. Guarda médias e variações de CPU, RAM, disco, GPU e temperatura para cada uma das 168 horas da semana. Assim sabe o que é "normal" numa terça às 15h. Minutos de lentidão não entram na média, para não virarem o novo normal.
2. Detecta episódios sustentados (CPU alta, memória no limite, temperatura alta, queda de clock com calor).
3. Registra qual programa estava no topo do consumo durante cada episódio e conta os reincidentes.
4. Ajusta a confiança de cada tipo de sugestão conforme o seu feedback ("ajudou" ou "não ajudou").

Tudo fica neste computador e pode ser exportado ou apagado em **Ajustes**.

## Executar em desenvolvimento

Requisitos: Windows, Node.js 20 ou superior e .NET SDK 10 para compilar o coletor de sensores.

```powershell
npm install
npm run build:sensors
npm start
```

Outros comandos:

```powershell
npm test         # testes do motor de análise (dados sintéticos)
npm run preview  # gera dev/preview.html: abre a interface num navegador, com dados fictícios
```

## Instalador e desinstalador

- **`npm run dist`** gera `release/Nexo-Setup-X.exe` (NSIS), o instalador "de verdade". É ele que o atualizador automático usa.
- **`installer-launcher/`** é o instalador visual (janela com a arte, opções, avisos e idioma PT/EN). Ele embute o `Nexo-Setup` e o executa em modo silencioso. Gere com `npm run build:launcher` (depois de `npm run dist`); o resultado fica em `installer-launcher/dist/Nexo-Instalador-X.exe`. Veja `installer-launcher/README.md`.
- A privacidade e os avisos aparecem no launcher e no assistente NSIS. O compartilhamento com o criador começa desativado.

### Desinstalação completa

Pelas Configurações do Windows ou por **Ajustes → Desinstalar o Nexo**, são removidos: o programa, os dados e preferências (`%APPDATA%\nexo-device-care`), os caches e o cache do atualizador (`%LOCALAPPDATA%`), atalhos, a chave `HKCU\Software\NexoDeviceCare` e a entrada de desinstalação. O caminho por **Ajustes** também apaga os rastros que o próprio Windows guarda sobre o Nexo (MuiCache, UserAssist e itens Recentes) e mostra ao final o que não conseguiu apagar. Atualizações **não** apagam os seus dados.

Fora do alcance de um programa sem administrador: logs de eventos do Windows, Prefetch e histórico do antivírus.

## Publicar uma versão

1. Altere `version` em `package.json` (e em `installer-launcher/package.json`) e envie o commit.
2. Crie uma tag `v` seguida exatamente da mesma versão. Para a `0.2.0`:

   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. A GitHub Action roda os testes, compila o coletor .NET, publica o instalador NSIS e anexa o instalador visual à release. Se o passo do instalador visual falhar, a release principal continua publicada.

O app instalado verifica atualizações ao iniciar e mostra a versão disponível na aba **Atualizações**. O download só começa quando a pessoa seleciona **Baixar atualização**. O atualizador funciona apenas na versão empacotada, e o repositório e as releases devem ser públicos.

### Assinatura digital

A compilação aceita um certificado Authenticode sem guardá-lo no repositório. Adicione em **Settings → Secrets and variables → Actions**: `WIN_CSC_LINK` (caminho/URL privada ou Base64 do `.pfx`) e `WIN_CSC_KEY_PASSWORD`. Sem eles a release é criada sem assinatura. Assine o launcher e o Setup com o mesmo certificado: um executável que roda outro em modo silencioso é um padrão que antivírus e o SmartScreen costumam estranhar.

## Limites e privacidade

- A disponibilidade das leituras depende do hardware, do firmware e da LibreHardwareMonitorLib. O Nexo não instala drivers de kernel.
- O diagnóstico indica possibilidades; não comprova causas e **nunca encerra processos**.
- A limpeza remove só arquivos regulares antigos (mais de 7 dias), ignora links e limita-se a 5.000 arquivos por execução. A "Limpeza automática" considera somente a pasta temporária e exige quatro leituras e 60 segundos com o disco acima de 90%, no máximo uma vez por hora.
- Trocar o plano de energia, otimizar unidades e verificar o sistema são ações explícitas; algumas podem pedir permissão de administrador ao Windows.
- Nada é enviado a servidores, exceto a consulta pública de atualizações ao GitHub. Consulte [PRIVACIDADE.md](PRIVACIDADE.md) para o inventário completo.
- No navegador (`npm run preview`), as ações que dependem do computador usam dados fictícios.
