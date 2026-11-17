/*
 * Ferramentas do conector do Claude. Cada uma reaproveita as consultas do painel e NUNCA devolve e-mail, equipe ou
 * chaves (nem para o dono). Spec: docs/superpowers/specs/2026-11-17-conector-claude-design.md
 */
import { ToolError } from './mcp.js';
import { RE, STATUSES, clampInt } from './validate.js';
import { CAMPOS, MEDIDAS, crossTab } from './cruzar.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
const TELEMETRY_BUDGET = 60000;
const TOP_N = 15;
/** Partes da telemetria agregada que vêm sempre (as listas entram cortadas no top 15). */
const ALWAYS = ['installs', 'reports', 'activeByDay', 'numbers'];

/** Dias pedidos (nulo ou vazio = o padrão, 30). */
const dias = (value, max = 120) => (value === null || value === undefined || value === '' ? Math.min(30, max) : clampInt(value, 1, max, 30));
const signatureOf = (value) => {
  if (typeof value !== 'string' || !RE.signature.test(value)) throw new ToolError('Assinatura inválida (16 caracteres hexadecimais, como aparece em nexo_erros).');
  return value;
};
const statusOf = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (!STATUSES.has(value)) throw new ToolError(`Status inválido. Use: ${[...STATUSES].join(', ')}.`);
  return value;
};

/** Telemetria agregada recortada: listas no top N (com o tamanho original em "cortado") até caber no orçamento. */
export function trimTelemetry(aggregate, { partes, days }) {
  const names = Object.keys(aggregate);
  if (Array.isArray(partes) && partes.length) {
    const wanted = partes.filter((name) => typeof name === 'string' && names.includes(name));
    if (!wanted.length) throw new ToolError(`Nenhuma parte conhecida. Partes: ${names.join(', ')}.`);
    return { dias: days, installs: aggregate.installs, reports: aggregate.reports, ...Object.fromEntries(wanted.map((name) => [name, aggregate[name]])) };
  }
  for (let top = TOP_N; top >= 3; top = Math.floor(top / 2)) {
    const out = { dias: days };
    const cortado = {};
    for (const name of names) {
      const value = aggregate[name];
      if (Array.isArray(value) && !ALWAYS.includes(name) && value.length > top) { out[name] = value.slice(0, top); cortado[name] = value.length; }
      else out[name] = value;
    }
    out.cortado = cortado;
    if (JSON.stringify(out).length <= TELEMETRY_BUDGET) return out;
  }
  return { dias: days, installs: aggregate.installs, reports: aggregate.reports, aviso: 'Grande demais: peça partes específicas.', partes: names };
}

export function createTools({ summaryData, usersData, errorListData, errorDetailRows, telemetryRows, aggregateTelemetry, markErrorByClaude, claudeHistory, queries, githubTotal, dailyStats }) {
  const github = async (env) => ({ ...((await githubTotal(env)) || { dia: null, total: null, porTag: [] }), impreciso: true, porque: 'O GitHub conta qualquer download, inclusive revisões e robôs; use a contagem por PC.' });
  return [
    {
      name: 'nexo_resumo',
      title: 'Resumo do Nexo',
      description: 'Visão geral do Nexo agora: erros abertos, contas, versões em uso e, em "contagem", o funil exato por PC (instalaram, abriram, usuários reais = 2+ dias, ativos hoje/7/30, desinstalaram, desligaram a contagem) e a retenção (1, 7 e 30 dias). Os campos antigos (instalações ativas pela telemetria, usuários novos) contam só quem manda telemetria ou erro. Comece por aqui.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
      run: async (_args, { env, now }) => {
        const [summary, funil, retencao] = await Promise.all([summaryData(env), queries.funil(env), queries.retencao(env)]);
        return { ...summary, contagem: { funil, retencao }, agora: now() };
      }
    },
    {
      name: 'nexo_usuarios',
      title: 'Usuários do Nexo',
      description: 'Usuários no período, contados por PC (exato; reinstalar no mesmo PC não conta de novo): funil, retenção, PCs ativos e novos por dia, avisos do instalador por dia (instalou, atualizou, desinstalou), quem desligou a contagem, as fotos diárias guardadas e os downloads do GitHub (impreciso, só referência). Em "antigo", a contagem de antes (só quem manda telemetria ou erro).',
      inputSchema: { type: 'object', properties: { dias: { type: 'integer', minimum: 1, maximum: 120, default: 30, description: 'Quantos dias para trás.' } }, additionalProperties: false },
      annotations: READ,
      run: async (args, { env }) => {
        const days = dias(args.dias);
        const [funil, retencao, porDia, gh, fotos, old] = await Promise.all([queries.funil(env), queries.retencao(env), queries.porDia(env, days), github(env), dailyStats(env, days), usersData(env, days)]);
        return { dias: days, funil, retencao, porDia, github: gh, fotos, antigo: { instalacoesVistas: old.instalacoesVistas, novosPorDia: old.novosPorDia } };
      }
    },
    {
      name: 'nexo_versoes',
      title: 'Saúde por versão',
      description: 'Cada versão do Nexo com PCs ativos em 7 dias, PCs desde que saiu, ≈ % de PCs sem erro (aproximado: instalações com erro ÷ PCs ativos), erros abertos e, na mais nova, as regressões (erros que só aparecem nela). Use para saber se uma versão nova piorou algo.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: READ,
      run: async (_args, { env }) => queries.versoes(env)
    },
    {
      name: 'nexo_erros',
      title: 'Erros agrupados',
      description: 'Lista dos erros agrupados por assinatura (reabertos e abertos primeiro): mensagem, origem, quantos PCs e ocorrências, versões, sistemas, status, versão da correção e nota. pcs_com_contato diz quantos PCs deixaram contato (os e-mails nunca vêm).',
      inputSchema: { type: 'object', properties: {
        status: { type: 'string', enum: [...STATUSES], description: 'Só os erros com esse status.' },
        incluir_avisos: { type: 'boolean', default: false, description: 'Incluir os avisos (nível "aviso"), além dos erros.' },
        limite: { type: 'integer', minimum: 1, maximum: 300, default: 50 }
      }, additionalProperties: false },
      annotations: READ,
      run: async (args, { env }) => {
        const rows = await errorListData(env, { status: statusOf(args.status), avisos: args.incluir_avisos === true, limite: clampInt(args.limite, 1, 300, 50) });
        return { grupos: rows.map(({ emails, ...row }) => ({ ...row, pcs_com_contato: Number(emails) || 0 })) };
      }
    },
    {
      name: 'nexo_erro',
      title: 'Detalhe de um erro',
      description: 'Um erro inteiro: mensagem, pilha, contexto, datas, status e os relatórios por PC (versão, sistema, contagem, datas e se deixou contato). Use a assinatura que vem em nexo_erros.',
      inputSchema: { type: 'object', properties: { assinatura: { type: 'string', pattern: '^[0-9a-f]{16}$' } }, required: ['assinatura'], additionalProperties: false },
      annotations: READ,
      run: async (args, { env }) => {
        const detail = await errorDetailRows(env, signatureOf(args.assinatura));
        if (!detail) throw new ToolError('Erro não encontrado.');
        return { group: detail.group, reports: detail.results.map(({ email, email_verified: verified, ...row }) => ({ ...row, temContato: Boolean(email), contatoConfirmado: Boolean(email) && verified === 1 })) };
      }
    },
    {
      name: 'nexo_telemetria',
      title: 'Telemetria agregada',
      description: 'Telemetria anônima agregada do período: PCs ativos por dia, números do dia (mediana e p90: tempo de uso, CPU e memória do Nexo, FPS do céu, travadas, hardware sob carga) e listas (versões, sistemas, hardware, monitores, ajustes, telas e recursos mais usados, canais lentos, falhas). Sem "partes", as listas vêm no top 15 (o tamanho original fica em "cortado"); com "partes", vem só o que pedir.',
      inputSchema: { type: 'object', properties: {
        dias: { type: 'integer', minimum: 1, maximum: 120, default: 30 },
        partes: { type: 'array', items: { type: 'string' }, description: 'Nomes das partes (ex.: gpus, versions, views, numbers).' }
      }, additionalProperties: false },
      annotations: READ,
      heavy: true,
      run: async (args, { env }) => {
        const days = dias(args.dias);
        return trimTelemetry(aggregateTelemetry(await telemetryRows(env, days)), { partes: args.partes, days });
      }
    },
    {
      name: 'nexo_marcar_erro',
      title: 'Marcar um erro',
      description: 'Muda o status de um erro: corrigido (com a versão em que a correção sai, ex.: 0.11.4), aberto, ignorado ou reaberto, com uma nota opcional. Se um erro corrigido voltar numa versão igual ou mais nova, ele reabre sozinho. A mudança fica registrada no painel, em "O que o Claude fez".',
      inputSchema: { type: 'object', properties: {
        assinatura: { type: 'string', pattern: '^[0-9a-f]{16}$' },
        status: { type: 'string', enum: [...STATUSES] },
        versao: { type: 'string', description: 'Versão da correção (obrigatória para "corrigido").' },
        nota: { type: 'string', maxLength: 500 }
      }, required: ['assinatura', 'status'], additionalProperties: false },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      needs: 'status',
      run: async (args, { env, who }) => {
        const signature = signatureOf(args.assinatura);
        const status = statusOf(args.status);
        if (!status) throw new ToolError('Diga o status: corrigido, aberto, ignorado ou reaberto.');
        const fixedIn = typeof args.versao === 'string' && RE.version.test(args.versao) ? args.versao : null;
        if (status === 'corrigido' && !fixedIn) throw new ToolError('Para marcar como corrigido, diga em qual versão a correção sai (ex.: 0.11.4).');
        let note; // sem nota: mantém a que já existe; nota vazia: apaga
        if (typeof args.nota === 'string') note = args.nota.trim() ? args.nota.slice(0, 500) : null;
        const result = await markErrorByClaude(env, who.grantId, signature, { status, fixedIn, note });
        if (!result) throw new ToolError('Erro não encontrado.');
        return result;
      }
    },
    {
      name: 'nexo_historico',
      title: 'O que o Claude fez',
      description: 'As últimas mudanças feitas pelo Claude no painel (quando, qual erro, antes e depois e por qual conexão), do mais novo ao mais velho.',
      inputSchema: { type: 'object', properties: { limite: { type: 'integer', minimum: 1, maximum: 200, default: 30 } }, additionalProperties: false },
      annotations: READ,
      run: async (args, { env }) => ({ acoes: await claudeHistory(env, clampInt(args.limite, 1, 200, 30)) })
    },
    {
      name: 'nexo_cruzar',
      title: 'Cruzar a telemetria',
      description: `Responde perguntas livres cruzando a telemetria anônima, por um catálogo fechado de campos. Sem "medida": conta PCs (o resumo mais recente de cada um) por "linha" (e "coluna", se vier). Com "medida": mediana e p90 da medida por "linha", entre todos os resumos do período. "filtro" restringe por campo = valor (ex.: { "sistema": "win32" }). Exemplo: quem tem AMD usa mais o Modo Leve? → linha gpu_marca, coluna efeitos.
Campos: ${Object.entries(CAMPOS).map(([name, field]) => `${name} (${field.titulo})`).join('; ')}.
Medidas: ${Object.entries(MEDIDAS).map(([name, measure]) => `${name} (${measure.titulo})`).join('; ')}.`,
      inputSchema: { type: 'object', properties: {
        linha: { type: 'string', description: 'Campo das linhas.' },
        coluna: { type: 'string', description: 'Campo das colunas (opcional).' },
        medida: { type: 'string', description: 'Medida para mediana e p90 por linha (opcional; não combina com coluna).' },
        filtro: { type: 'object', additionalProperties: { type: ['string', 'number', 'boolean'] }, description: 'Campo → valor que a linha precisa ter.' },
        dias: { type: 'integer', minimum: 1, maximum: 60, default: 30 }
      }, required: ['linha'], additionalProperties: false },
      annotations: READ,
      heavy: true,
      run: async (args, { env }) => {
        const days = dias(args.dias, 60);
        const rows = await telemetryRows(env, days); // falha do banco = erro interno, não erro de argumento
        let table;
        try { table = crossTab(rows, { linha: args.linha, coluna: args.medida ? undefined : args.coluna, medida: args.medida, filtro: args.filtro }); }
        catch (error) { throw new ToolError(error.message); }
        return { dias: days, ...table };
      }
    }
  ];
}
