# Nexo Device Care

Aplicativo desktop para Windows que reúne indicadores do computador e ferramentas básicas de manutenção. O projeto está em desenvolvimento; as recomendações de diagnóstico são heurísticas e não prometem aumentar o desempenho em todos os PCs.

## Recursos atuais

- Visão geral com um veredito em linguagem simples (em bom estado, atenção ou crítico) e cartões de CPU, memória, disco, GPU NVIDIA compatível e temperaturas reportadas por sensores disponíveis. Os limites de alerta aparecem como linha tracejada em cada gráfico.
- Cada cartão mostra o histórico local dos últimos cinco minutos, atualizado a cada cinco segundos. Com a janela minimizada, as leituras ficam bem mais espaçadas (30 a 60 segundos) para poupar recursos. Leituras mais lentas de disco e temperatura são reutilizadas por alguns segundos.
- Diagnóstico sob demanda com os cinco processos que mais consomem CPU e memória, comparação robusta com a mediana local e sugestões de próximos passos.
- Página Manutenção com limpeza de temporários (prévia antes de remover), limpeza automática opcional, otimização de unidade pela ferramenta do Windows e verificação de arquivos protegidos do sistema. Cada tarefa mostra quando foi executada pela última vez e pede confirmação em um diálogo próprio.
- Atividade registrada por dia, com opção de limpar o histórico. Atalhos Ctrl+1 a Ctrl+5 trocam de tela.
- Wallpaper personalizável: a imagem é reduzida e comprimida antes de ser guardada, e a opacidade do véu da interface se ajusta ao brilho da imagem para manter o texto legível.
- Histórico local de desempenho e feedback das recomendações, usados para contextualizar os diagnósticos.

## Executar em desenvolvimento

Requisitos: Windows e Node.js 20 ou superior.

Na pasta do projeto, instale as dependências e inicie o aplicativo:

```powershell
npm install
npm start
```

## Gerar o instalador localmente

```powershell
npm run dist
```

O assistente do Windows permite escolher a pasta de instalação e exige a leitura e o aceite dos avisos antes de continuar. Ao concluir, o aplicativo é aberto. O instalador Windows x64 é gerado na pasta `release/`.

## Publicar uma versão

1. Altere o campo `version` em `package.json` e envie o commit para o GitHub.
2. Crie uma tag `v` seguida exatamente da mesma versão. Por exemplo, para a versão `0.1.3`:

   ```powershell
   git tag v0.1.3
   git push origin v0.1.3
   ```

3. A GitHub Action compila o instalador Windows x64 e publica a release. Acompanhe a execução na aba **Actions**; após o sucesso, os arquivos ficam na página **Releases**.

O aplicativo instalado verifica atualizações ao iniciar e mostra a versão disponível na aba **Atualizações**. O download só começa quando a pessoa seleciona **Baixar e atualizar**; depois, ela escolhe quando instalar e reiniciar o app. O atualizador funciona apenas na versão empacotada. Para que outras pessoas baixem atualizações sem autenticação, o repositório e as releases devem ser públicos.

## Limites e privacidade

- As leituras são feitas localmente. A temperatura ACPI depende do suporte do firmware; métricas de GPU dependem de uma NVIDIA compatível e do comando `nvidia-smi`. Muitos PCs não expõem sensores térmicos ao aplicativo, e nesses casos a temperatura aparece como indisponível.
- Os gráficos usam amostras da sessão atual e guardam no máximo cinco minutos em memória. Eles não são enviados a servidores nem substituem ferramentas de diagnóstico do fabricante.
- O diagnóstico usa sinais observáveis e regras heurísticas; indica possibilidades, não comprova causas. Ele não encerra processos.
- O histórico usado pelo diagnóstico guarda até sete dias de amostras locais, em intervalos de cinco minutos. O feedback também fica neste computador; esses dados não são enviados para servidores.
- A limpeza exibe uma prévia e remove somente arquivos regulares diretamente na pasta temporária do usuário, com mais de sete dias. A remoção é definitiva (os arquivos não vão para a Lixeira). Há um limite de 5.000 arquivos por execução; subpastas e links são ignorados.
- A limpeza automática é opcional e só é executada após ativação explícita. Ela exige quatro leituras e pelo menos 60 segundos com o disco principal acima de 90%, respeitando um intervalo mínimo de uma hora entre execuções.
- A otimização de unidades usa a ferramenta nativa do Windows. A verificação de arquivos protegidos executa `sfc /scannow`. Essas operações pedem confirmação e podem solicitar elevação de permissão pelo Windows.
- Limpeza, otimização de unidade e verificação SFC não rodam ao mesmo tempo, e o aplicativo abre uma única janela por vez.
- No navegador, as operações que dependem do computador ficam indisponíveis; use o aplicativo desktop.
