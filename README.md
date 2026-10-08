# Nexo Device Care

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
- A limpeza mostra uma prévia e remove apenas arquivos regulares no diretório temporário do usuário com mais de sete dias, limitada a dois níveis de pastas e 5.000 arquivos por execução.
- A otimização usa a ferramenta nativa do Windows. A verificação de arquivos protegidos usa `sfc /scannow`. Ambas pedem confirmação e podem solicitar permissão de administrador pelo Windows.
- No navegador, operações locais ficam indisponíveis; use o aplicativo desktop para executá-las.
