# Instalador visual do Nexo

Janela em Electron com a arte de fundo que roda o `Nexo-Setup` (NSIS) em modo silencioso.
O Setup original continua sendo o que o `electron-updater` usa nas atualizações.

## Como usar
1. Na raiz do projeto: `npm run dist` (gera `release/Nexo-Setup-X.exe`).
2. Aqui dentro: `npm install`, depois `npm start` para testar ou `npm run dist` para gerar `dist/Nexo-Instalador-X.exe`.

## Ajustes
- `EXPECTED_MB` no `main.cjs`: instale uma vez, veja o tamanho da pasta e coloque o valor. Ele só calibra a barra de progresso.
- Ícone do app principal: no `package.json` da raiz, adicione `"icon": "assets/icon.ico"` dentro de `build.win`.

## release.yml (já aplicado neste repositório)
Os passos "Build visual installer" e "Upload visual installer to the release" já estão no `.github/workflows/release.yml`.

## Cuidados
- Assine o launcher e o Setup com o mesmo certificado: um .exe que roda outro .exe em modo silencioso é padrão que antivírus e SmartScreen desconfiam.
- O launcher embute o Setup, então o download fica grande (Electron + Setup).
