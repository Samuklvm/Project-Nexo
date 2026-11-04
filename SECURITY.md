# Política de Segurança | Security Policy

## Português

### Versões com suporte

Esta política cobre a versão estável mais recente do Nexo publicada na página de [Releases](https://github.com/Samuklvm/Project-Nexo/releases). Relatos sobre outras versões também podem ser enviados, mas as correções serão priorizadas para a versão mais recente.

### O que está no escopo

Considere reportar problemas de segurança relacionados a:

- execução de código ou comandos sem autorização;
- falhas na comunicação entre a interface, o processo principal do Electron e o coletor de sensores;
- elevação indevida de privilégios ou alterações no Windows sem a confirmação esperada;
- acesso, exposição ou transmissão não autorizada de dados locais do Nexo;
- exclusão ou alteração inesperada de arquivos ou configurações;
- comprometimento da integridade do instalador, do atualizador ou dos arquivos distribuídos nas Releases.

O Nexo processa dados localmente. Conforme a documentação do projeto, a consulta de rede prevista é a verificação de atualizações no GitHub. Uma falha que faça dados do computador serem enviados sem consentimento explícito também deve ser reportada.

### Como reportar

Envie o relato de forma privada pelo recurso **Report a vulnerability** na aba **Security** do repositório. Para que essa opção esteja disponível, o mantenedor precisa habilitar o recebimento privado de relatos nas configurações de segurança do GitHub.

Inclua, se possível:

- a versão do Nexo e do Windows afetada;
- uma descrição do impacto e das condições necessárias;
- passos para reproduzir o problema em um ambiente próprio;
- uma prova de conceito segura, se ela ajudar a demonstrar a falha;
- possíveis medidas temporárias para reduzir o risco.

Remova senhas, tokens, endereços pessoais e dados de uso do computador de capturas de tela, arquivos ou logs. Não anexe uma exportação completa dos dados locais do Nexo.

Se o recurso de relato privado não estiver disponível, não publique detalhes exploráveis em uma Issue. Procure um canal privado de contato indicado pelo mantenedor no GitHub.

### Conduta durante a análise

Teste somente em dispositivos e contas que você controla ou tem autorização para testar. Não tente acessar dados de outras pessoas, interromper serviços ou alterar sistemas sem permissão.

Pedimos que não divulgue publicamente os detalhes da vulnerabilidade antes de uma correção ou de um acordo com o mantenedor. O mantenedor buscará confirmar o recebimento em até 7 dias corridos e compartilhar atualizações sobre a análise ou a correção em até 30 dias. O prazo pode variar conforme a complexidade do problema.

---

## English

### Supported versions

This policy covers the latest stable version of Nexo published on the [Releases](https://github.com/Samuklvm/Project-Nexo/releases) page. Reports affecting other versions are also welcome, but fixes will be prioritized for the latest version.

### Scope

Please report security issues related to:

- unauthorized code or command execution;
- flaws in communication between the interface, the Electron main process, and the sensor collector;
- improper privilege escalation or Windows changes made without the expected confirmation;
- unauthorized access to, exposure of, or transmission of Nexo’s local data;
- unexpected deletion or modification of files or settings;
- compromise of the integrity of the installer, updater, or files distributed through Releases.

Nexo processes data locally. According to the project documentation, its expected network request is the GitHub update check. Please also report any flaw that causes computer data to be sent without explicit consent.

### How to report a vulnerability

Please submit your report privately using **Report a vulnerability** under the repository’s **Security** tab. The maintainer must enable private vulnerability reporting in the repository’s GitHub security settings for this option to be available.

If possible, include:

- the affected Nexo and Windows versions;
- a description of the impact and required conditions;
- steps to reproduce the issue in an environment you own or are authorized to test;
- a safe proof of concept, if it helps demonstrate the issue;
- any temporary steps that could reduce the risk.

Remove passwords, tokens, personal addresses, and computer usage data from screenshots, files, or logs. Do not attach a full export of Nexo’s local data.

If private reporting is unavailable, do not post exploitable details in a public Issue. Look for a private contact channel listed by the maintainer on GitHub.

### Coordinated disclosure

Test only on devices and accounts you own or are authorized to test. Do not access other people’s data, disrupt services, or modify systems without permission.

Please do not publicly disclose vulnerability details before a fix is available or disclosure has been coordinated with the maintainer. The maintainer will aim to acknowledge reports within 7 calendar days and provide an update on the investigation or fix within 30 days. Timelines may vary depending on the complexity of the issue.
