# Avisos de componentes de terceiros

## LibreHardwareMonitorLib 0.9.6

O Nexo inclui `LibreHardwareMonitorLib` para ler sensores locais de hardware. A biblioteca é distribuída sob a Mozilla Public License 2.0 (MPL-2.0). O código-fonte e os avisos de licença estão disponíveis em <https://github.com/LibreHardwareMonitor/LibreHardwareMonitor>; o texto da licença está em <https://www.mozilla.org/MPL/2.0/>.

O coletor do Nexo está em `sensor-host/` e o projeto não altera nem substitui a licença da biblioteca. Os demais arquivos do Nexo permanecem sujeitos à licença indicada pelo próprio projeto.

### Bibliotecas que vêm junto com o LibreHardwareMonitorLib

O pacote do LibreHardwareMonitorLib traz estas dependências, que vão dentro do executável do coletor (`Nexo.SensorHost.exe`) exatamente como publicadas no NuGet. O Nexo não altera nenhuma delas.

| Pacote | Versão | Licença | Código-fonte |
| --- | --- | --- | --- |
| BlackSharp.Core | 1.0.7 | MPL-2.0 | <https://github.com/Blacktempel/BlackSharp> |
| DiskInfoToolkit | 1.1.2 | MPL-2.0 (partes baseadas no CrystalDiskInfo, licença MIT) | <https://github.com/Blacktempel/DiskInfoToolkit> |
| RAMSPDToolkit-NDD | 1.4.2 | MPL-2.0 | <https://github.com/Blacktempel/RAMSPDToolkit> |
| HidSharp | 2.6.4 | Apache License 2.0, Copyright 2010-2025 James F. Bellinger | <https://software.seekye.com/hidsharp> |
| Mono.Posix.NETStandard | 1.0.0 | MIT (bibliotecas de classe do Mono, Microsoft/Xamarin) | <https://github.com/mono/mono.posix> |

A MPL-2.0 é uma licença copyleft por arquivo: quem distribui uma versão modificada de um arquivo coberto por ela precisa publicar essa modificação. O Nexo distribui esses arquivos sem modificação; o código-fonte de cada um está nos endereços acima e o texto da licença em <https://www.mozilla.org/MPL/2.0/>. O texto da Apache License 2.0 está em <https://www.apache.org/licenses/LICENSE-2.0>. Os demais pacotes do .NET usados pelo coletor (System.\* e Microsoft.\*) são da Microsoft e da .NET Foundation, sob a licença MIT.

## PresentMon (componente opcional)

Para medir FPS e tempo de quadro, o Nexo pode executar o **PresentMon**, ferramenta de captura de desempenho gráfico da Intel (<https://github.com/GameTechDev/PresentMon>), distribuída sob a licença MIT. O Nexo não altera o PresentMon: ele é executado como um programa separado, somente quando você ativa a medição de FPS, e os dados lidos (eventos de apresentação do Windows do programa escolhido) ficam neste computador. A versão e o hash embutidos são fixados em `third-party/presentmon.lock.json`; sem hash fixado, nada é embutido e você pode apontar um `PresentMon.exe` baixado por conta própria.

```
MIT License

Copyright (C) 2017-2024 Intel Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Inter (fonte da interface)

A interface usa a fonte **Inter** 4.1 (<https://github.com/rsms/inter>), de Rasmus Andersson e colaboradores, distribuída sob a SIL Open Font License 1.1. O arquivo `assets/fonts/InterVariable.woff2` não foi modificado; o texto completo da licença está em `assets/fonts/Inter-LICENSE.txt`.

## PawnIO (driver de sensores, Windows)

Para ler a temperatura do processador e da placa-mãe no Windows, o Nexo instala o **PawnIO** 2.2.0 (<https://pawnio.eu>, código-fonte em <https://github.com/namazso/PawnIO> e <https://github.com/namazso/PawnIO.Setup>), driver assinado usado também pelo LibreHardwareMonitor. O Nexo não inclui nem modifica o PawnIO: o instalador oficial é baixado da página de releases do projeto no GitHub, conferido pelo SHA-256 `1f519a22e47187f70a1379a48ca604981c4fcf694f4e65b734aaa74a9fba3032` e executado com a permissão da pessoa (UAC). O PawnIO segue sob as licenças do próprio projeto.

## Microsoft.Extensions.Hosting.WindowsServices

O serviço de sensores usa o pacote **Microsoft.Extensions.Hosting.WindowsServices** 10.0.14 (<https://github.com/dotnet/runtime>), da .NET Foundation, distribuído sob a licença MIT.
