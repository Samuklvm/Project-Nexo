# Nexo Device Care
```bash
EM FASE DE DESENVOLVIMENTO(Projeto independente)
```
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

1. Atualize `version` em `package.json` (por exemplo, de `0.1.0` para `0.1.1`) e envie o commit para o GitHub.
2. Crie e envie uma tag com a mesma versão, prefixada por `v`:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. A GitHub Action compila o instalador Windows x64 e publica uma release com o instalador e os arquivos necessários ao atualizador. Acompanhe o processo na aba **Actions** do GitHub.

O aplicativo instalado verifica atualizações ao iniciar, baixa as versões novas automaticamente e instala a atualização ao fechar; também oferece o botão **Instalar atualização** quando o download termina. O atualizador só funciona no aplicativo empacotado. Para que instalações de terceiros baixem os arquivos sem token, o repositório e as releases precisam ser públicos.

## Importante

- CPU, memória, espaço em disco e interfaces de rede são leituras locais; temperatura de componentes não é medida.
- O diagnóstico sob demanda identifica os processos com maior uso de CPU e memória em uma amostra de um segundo, apresenta causas prováveis e próximos passos; ele pode abrir o Gerenciador de Tarefas, mas nunca encerra processos.
- O app guarda localmente até sete dias de amostras (uma a cada 15 minutos) para comparar o uso atual com o padrão recente; avaliações das recomendações ajustam a confiança heurística apresentada e não são enviadas para servidores. Essa análise usa heurísticas e sinais observáveis, não comprova causalidade nem substitui uma análise especializada.
- A limpeza mostra uma prévia e remove apenas arquivos regulares diretamente no diretório temporário canônico do usuário com mais de sete dias, limitada a 5.000 arquivos por execução; subpastas e links são ignorados.
- A limpeza automática é opcional: após ativação explícita, exige quatro leituras e pelo menos 60 segundos com o disco principal acima de 90%, e respeita um intervalo mínimo de uma hora entre tentativas.
- A otimização usa a ferramenta nativa do Windows. A verificação de arquivos protegidos usa `sfc /scannow`. Ambas pedem confirmação e podem solicitar permissão de administrador pelo Windows.
- No navegador, operações locais ficam indisponíveis; use o aplicativo desktop para executá-las.
