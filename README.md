# Nexo Device Care
EM FASE DE DESENVOLVIMENTO(Projeto independente)
Aplicativo desktop para Windows com painel de uso de CPU, memória, unidades locais e interfaces de rede.

## Como rodar localmente

1. Instale Node.js 20+.
2. Abra a pasta do projeto.
3. Execute:
   ```bash
   npm install
   npm start
   ```

## Como gerar o instalador

```bash
npm run dist
```

## Como publicar atualização

1. Atualize a versão do app em `package.json`.
2. Configure um token do GitHub com permissão para publicar releases na variável de ambiente `GH_TOKEN`.
3. Execute:
   ```bash
   npm run release
   ```
4. O electron-builder cria a GitHub Release e envia o instalador e os arquivos de atualização. O atualizador só funciona no aplicativo empacotado.

## Importante

- CPU, memória, espaço em disco e interfaces de rede são leituras locais; temperatura de componentes não é medida.
- O diagnóstico sob demanda identifica os processos com maior uso de CPU e memória em uma amostra de um segundo, apresenta causas prováveis e próximos passos; ele pode abrir o Gerenciador de Tarefas, mas nunca encerra processos.
- O app guarda localmente até sete dias de amostras (uma a cada 15 minutos) para comparar o uso atual com o padrão recente; avaliações das recomendações ajustam a confiança heurística apresentada e não são enviadas para servidores. Essa análise usa heurísticas e sinais observáveis, não comprova causalidade nem substitui uma análise especializada.
- A limpeza mostra uma prévia e remove apenas arquivos regulares diretamente no diretório temporário canônico do usuário com mais de sete dias, limitada a 5.000 arquivos por execução; subpastas e links são ignorados.
- A limpeza automática é opcional: após ativação explícita, exige quatro leituras e pelo menos 60 segundos com o disco principal acima de 90%, e respeita um intervalo mínimo de uma hora entre tentativas.
- A otimização usa a ferramenta nativa do Windows. A verificação de arquivos protegidos usa `sfc /scannow`. Ambas pedem confirmação e podem solicitar permissão de administrador pelo Windows.
- No navegador, operações locais ficam indisponíveis; use o aplicativo desktop para executá-las.
