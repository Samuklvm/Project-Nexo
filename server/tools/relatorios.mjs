/*
 * Copia os erros abertos do servidor do Nexo para issues de um repositório PRIVADO (uma issue por erro).
 * Roda numa rotina do GitHub Actions do repositório privado (ver relatorios.yml). Variáveis:
 *   NEXO_SERVER_URL   endereço do servidor (https://nexo-api.<conta>.workers.dev)
 *   NEXO_TOOLS_KEY    chave de acesso criada no painel (só leitura, sem e-mails)
 *   GITHUB_TOKEN      token do próprio Actions (permissão issues: write)
 *   GITHUB_REPOSITORY dono/repositório (o Actions já preenche)
 */
export const LABEL = 'erro-nexo';
export const marker = (signature) => `<!-- nexo:${signature} -->`;

export function issueTitle(group) {
  const message = String(group.message || 'Erro sem mensagem').replace(/\s+/g, ' ').slice(0, 110);
  return `${group.status === 'reaberto' ? '[voltou] ' : ''}${message}`;
}

export function issueBody(group) {
  const when = (ms) => (ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '--');
  return [
    marker(group.signature),
    `**${group.occurrences} ocorrência(s) em ${group.installs} PC(s)** · ${group.level} · ${group.source}`,
    `Versões: ${group.versions || '--'} · Sistemas: ${group.platforms || '--'}`,
    `Primeira vez: ${when(group.first_at)} · Última vez: ${when(group.last_at)}`,
    group.status === 'reaberto' ? `Estava corrigido na ${group.fixed_in} e voltou.` : '',
    group.context ? `\nContexto: \`${String(group.context).replace(/`/g, "'")}\`` : '',
    group.stack ? `\n\`\`\`\n${String(group.stack).replace(/```/g, "'''").slice(0, 3500)}\n\`\`\`` : '',
    '\n_Atualizada pela rotina de relatórios. Marque como corrigido no painel do Nexo; esta issue fecha sozinha na próxima rodada._'
  ].filter(Boolean).join('\n');
}

/** O que fazer: criar, atualizar ou fechar issues, comparando os erros abertos com as issues abertas. */
export function plan(groups, issues) {
  const bySignature = new Map();
  for (const issue of issues) {
    const found = /<!-- nexo:([0-9a-f]{16}) -->/.exec(issue.body || '');
    if (found) bySignature.set(found[1], issue);
  }
  const actions = [];
  const open = new Set();
  for (const group of groups) {
    open.add(group.signature);
    const issue = bySignature.get(group.signature);
    const title = issueTitle(group);
    const body = issueBody(group);
    if (!issue) actions.push({ type: 'create', title, body });
    else if (issue.title !== title || issue.body !== body) actions.push({ type: 'update', number: issue.number, title, body });
  }
  for (const [signature, issue] of bySignature) if (!open.has(signature)) actions.push({ type: 'close', number: issue.number });
  return actions;
}

async function main() {
  const { NEXO_SERVER_URL, NEXO_TOOLS_KEY, GITHUB_TOKEN, GITHUB_REPOSITORY } = process.env;
  if (!NEXO_SERVER_URL || !NEXO_TOOLS_KEY || !GITHUB_TOKEN || !GITHUB_REPOSITORY) throw new Error('Faltam NEXO_SERVER_URL, NEXO_TOOLS_KEY, GITHUB_TOKEN ou GITHUB_REPOSITORY.');
  const server = await fetch(`${NEXO_SERVER_URL.replace(/\/+$/, '')}/v1/tools/errors`, { headers: { authorization: `Bearer ${NEXO_TOOLS_KEY}` } });
  if (!server.ok) throw new Error(`O servidor respondeu ${server.status}.`);
  const { groups } = await server.json();
  const gh = async (method, route, body) => {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${route}`, { method, headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error(`GitHub ${method} ${route}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const issues = [];
  for (let page = 1; page <= 10; page += 1) {
    const batch = await gh('GET', `/issues?state=open&labels=${LABEL}&per_page=100&page=${page}`);
    issues.push(...batch.filter((item) => !item.pull_request));
    if (batch.length < 100) break;
  }
  const actions = plan(groups, issues);
  for (const action of actions) {
    if (action.type === 'create') await gh('POST', '/issues', { title: action.title, body: action.body, labels: [LABEL] });
    if (action.type === 'update') await gh('PATCH', `/issues/${action.number}`, { title: action.title, body: action.body });
    if (action.type === 'close') await gh('PATCH', `/issues/${action.number}`, { state: 'closed', state_reason: 'completed' });
  }
  console.log(`${groups.length} erro(s) aberto(s): ${actions.filter((a) => a.type === 'create').length} nova(s), ${actions.filter((a) => a.type === 'update').length} atualizada(s), ${actions.filter((a) => a.type === 'close').length} fechada(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { console.error(error.message); process.exit(1); });
