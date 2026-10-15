# Nexo Device Care

Aplicativo desktop para Windows que reúne indicadores do computador e ferramentas básicas de manutenção. O projeto está em desenvolvimento; as recomendações de diagnóstico são heurísticas e não prometem aumentar o desempenho em todos os PCs.

## Recursos atuais

- Painel com uso de CPU e memória, espaço em disco, estado da rede e versão do aplicativo.
- Diagnóstico sob demanda com uma amostra de processos que mais consomem CPU ou memória e sugestões de próximos passos.
- Prévia e remoção de arquivos temporários antigos do usuário.
- Limpeza automática opcional quando o disco principal permanece com uso elevado.
- Abertura do Gerenciador de Tarefas, otimização de unidade pela ferramenta do Windows e verificação de arquivos protegidos do sistema.
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
2. Crie uma tag `v` seguida exatamente da mesma versão. Por exemplo, para a versão `0.1.1`:

   ```powershell
   git tag v0.1.1
   git push origin v0.1.1
   ```

3. A GitHub Action compila o instalador Windows x64 e publica a release. Acompanhe a execução na aba **Actions**; após o sucesso, os arquivos ficam na página **Releases**.

O aplicativo instalado verifica atualizações ao iniciar e baixa novas versões automaticamente. Depois do download, é possível instalá-las pelo botão do aplicativo ou ao fechar e abrir o programa. O atualizador funciona apenas na versão empacotada. Para que outras pessoas baixem atualizações sem autenticação, o repositório e as releases devem ser públicos.

## Limites e privacidade

- As leituras são feitas localmente. O app não mede temperatura dos componentes.
- O diagnóstico usa sinais observáveis e regras heurísticas; indica possibilidades, não comprova causas. Ele não encerra processos.
- O histórico guarda até sete dias de amostras locais, em intervalos de 15 minutos. O feedback também fica neste computador; esses dados não são enviados para servidores.
- A limpeza exibe uma prévia e remove somente arquivos regulares diretamente na pasta temporária do usuário, com mais de sete dias. Há um limite de 5.000 arquivos por execução; subpastas e links são ignorados.
- A limpeza automática é opcional e só é executada após ativação explícita. Ela exige quatro leituras e pelo menos 60 segundos com o disco principal acima de 90%, respeitando um intervalo mínimo de uma hora entre execuções.
- A otimização de unidades usa a ferramenta nativa do Windows. A verificação de arquivos protegidos executa `sfc /scannow`. Essas operações pedem confirmação e podem solicitar elevação de permissão pelo Windows.
- No navegador, as operações que dependem do computador ficam indisponíveis; use o aplicativo desktop.
