# Nexo Device Care

Aplicativo desktop para Windows com visual gamer em tema escuro roxo/ciano, painel de saúde do PC, seleção de unidade de disco e fluxo de otimização.

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
2. Crie uma tag com a mesma versão:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. O GitHub Actions monta o instalador e envia para a aba Releases.

## Importante

- A interface funciona em navegador como demo.
- O comportamento real de otimização e manutenção de disco fica restrito ao ambiente desktop com permissões locais.
- O app é pensado para distribuição em PCs Windows e atualização remota por GitHub Releases.
