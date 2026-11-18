/*
 * Vigias de erro: os AVISOS do app (coisa funcionando de forma estranha), juntados pelo tipo de vigia que mandou
 * (context.vigia). Só contagens e a mensagem mais comum; nada de e-mail. Os avisos nunca entram no alarme de regressão.
 * Spec: docs/superpowers/specs/2026-11-18-vigias-de-erro-design.md
 */
const DAY_MS = 24 * 3600 * 1000;
/** O contexto chega como JSON cortado em 1.500 caracteres (pode vir inválido): o vigia fica no começo, antes da trilha. */
const VIGIA_RE = /"vigia"\s*:\s*"([a-z0-9-]{1,40})"/i;
export const vigiaOf = (context) => (VIGIA_RE.exec(String(context || ''))?.[1] || 'outro').toLowerCase();

/** Avisos dos últimos `dias` dias, por vigia: grupos, abertos, PCs (instalações), ocorrências, versões e um exemplo. */
export async function vigias(env, { dias = 7, agora = Date.now() } = {}) {
  const since = agora - dias * DAY_MS;
  const [groups, reports, abertos] = await Promise.all([
    env.DB.prepare(`SELECT signature, message, context, status, last_at FROM error_groups WHERE level = 'aviso' AND last_at >= ? ORDER BY last_at DESC LIMIT 2000`).bind(since).all(),
    // PCs, ocorrências e versões só do período: o histórico por versão (error_seen) com o último dia de cada um.
    env.DB.prepare(`SELECT s.signature, s.install_id, s.version, s.count FROM error_seen s JOIN error_groups g ON g.signature = s.signature
      WHERE g.level = 'aviso' AND s.last_at >= ? LIMIT 20000`).bind(since).all(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM error_groups WHERE level = 'aviso' AND status IN ('aberto', 'reaberto')").first()
  ]);
  const bySig = new Map();
  for (const group of groups.results || []) bySig.set(group.signature, { ...group, vigia: vigiaOf(group.context), installs: new Set(), versions: new Set(), count: 0 });
  for (const row of reports.results || []) {
    const group = bySig.get(row.signature);
    if (!group) continue;
    group.installs.add(row.install_id);
    group.versions.add(row.version);
    group.count += Number(row.count) || 0;
  }
  const byVigia = new Map();
  for (const group of bySig.values()) {
    const item = byVigia.get(group.vigia) || { vigia: group.vigia, grupos: 0, abertos: 0, installs: new Set(), versions: new Set(), ocorrencias: 0, ultimo: 0, exemplo: null, exemploN: -1 };
    item.grupos += 1;
    if (group.status === 'aberto' || group.status === 'reaberto') item.abertos += 1;
    for (const id of group.installs) item.installs.add(id);
    for (const version of group.versions) item.versions.add(version);
    item.ocorrencias += group.count;
    item.ultimo = Math.max(item.ultimo, Number(group.last_at) || 0);
    if (group.count > item.exemploN) { item.exemplo = group.message; item.exemploN = group.count; }
    byVigia.set(group.vigia, item);
  }
  const list = [...byVigia.values()].map(({ installs, versions, exemploN, ...rest }) => ({ ...rest, pcs: installs.size, versoes: [...versions].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) }))
    .sort((a, b) => b.pcs - a.pcs || b.ocorrencias - a.ocorrencias || a.vigia.localeCompare(b.vigia));
  return { dias, vigias: list, total: { grupos: bySig.size, avisosAbertos: Number(abertos?.n) || 0 } };
}
