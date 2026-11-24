/*
 * Cortex — narrador. Transforma cada passo do raciocínio numa frase simples em português, na primeira pessoa
 * ("Notei…", "Suspeito de…", "Vou medir…"). A frase é guardada para sempre na memória e mostrada à pessoa.
 *
 * Puro: sem disco, sem relógio. Tom amigável e honesto: nada de "provavelmente", "talvez seja", "deve ser" ou
 * "com certeza" — o que é suspeita fica como suspeita e só um experimento vira afirmação.
 *
 * Vocabulários (os mesmos do forjador e das crenças):
 *   action    'lembrar' | 'esperar' | 'medir' | 'intervir'
 *   expect    'sobe' | 'desce' | 'igual' | 'presente' | 'ausente' | 'antes' | 'depois'
 *   observed  os de expect, mais 'interrompido' (teste cortado porque a pessoa voltou; não conta como evidência).
 *             Qualquer outro valor é narrado como "não consegui classificar", sem afirmar nada.
 * Prediction = { action, target, expect }.
 * Outcome    = { action, target, observed, significant } (significant: false = diferença pequena, pesa pouco).
 * verdict    = { status, winner, refuted }: status 'apoiada' | 'correlacionada' | 'aberta' | 'nao-resolvido'
 *              ('nao-resolvido' vem do motor, não de beliefs.js); winner e refuted são chaves "causa>sintoma".
 *
 * Passos aceitos (step.type):
 *   notei        { signal, value?, symptom? }        (value: número; symptom: id de sinal)
 *   suspeito     { hypothesis, belief? }             (hypothesis do forjador; belief entre 0 e 1)
 *   plano        { prediction }
 *   resultado    { outcome, prediction? }
 *   conclusao    { verdict, missing? }               (missing: lista de ids de sinal que faltou medir)
 *   necessidade  { signal?, reason? }
 *   pedido       { text?, signal?, minutes? }        (text: o pedido no imperativo, com ou sem ponto final)
 *   ritmo        { state: 'leve' | 'profundo', reason? }
 *   interrompido { target? }                         (teste cortado porque a pessoa voltou; não conta como evidência)
 * Um id de sinal que o mapa não conhece aparece como está, sem quebrar.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./relations.js'));
  else root.NexoNarrate = factory(root.NexoRelations);
})(typeof self !== 'undefined' ? self : this, function (Relations) {
  const SIGNALS = (Relations && Relations.SIGNALS) || {};

  const comma = (value, digits = 1) => value.toFixed(digits).replace('.', ',');
  /** Número com vírgula decimal; inteiros ficam sem casas. */
  const num = (v) => (Number.isInteger(v) ? String(v) : comma(v));
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const str = (v) => (typeof v === 'string' ? v : '');

  /** Nome de gente de um sinal; id desconhecido volta como veio. Entre aspas para a frase não embolar. */
  const name = (id) => {
    const raw = str(id);
    const s = SIGNALS[raw];
    return `“${s && s.label ? s.label : raw}”`;
  };
  const unitOf = (id) => (SIGNALS[id] && SIGNALS[id].unit) || '';
  const withUnit = (id, value) => {
    const u = unitOf(id);
    return `${num(value)}${u ? (u === '%' ? '%' : ` ${u}`) : ''}`;
  };
  const VOCAB = ['sobe', 'desce', 'igual', 'presente', 'ausente', 'antes', 'depois'];
  const causeOf = (key) => str(key).split('>')[0];
  const ending = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
  const percent = (b) => (finite(b) ? `${Math.round(b * 100)}%` : '');

  /** O que se espera de um alvo, dito com naturalidade. */
  function expectation(action, target, expect) {
    const t = name(target);
    switch (expect) {
      case 'sobe': return action === 'intervir' ? `${t} aumenta` : `${t} sobe`;
      case 'desce': return `${t} cai`;
      case 'igual': return `${t} fica como está`;
      case 'presente': return `${t} aparece`;
      case 'ausente': return `${t} não aparece`;
      case 'antes': return `${t} começou a subir antes do sintoma`;
      case 'depois': return `${t} só subiu depois do sintoma, ou junto com ele`;
      default: return `${t} muda de um jeito que eu consigo comparar`;
    }
  }

  const SAY = {
    notei(s) {
      const id = str(s.signal);
      if (!id) return 'Notei algo diferente, mas ainda não sei dizer o quê.';
      const value = finite(s.value) ? ` em ${withUnit(id, s.value)}` : '';
      const sym = s.symptom ? `, junto com ${name(s.symptom)}` : '';
      return `Notei ${name(id)}${value}${sym}.`;
    },

    suspeito(s) {
      const h = s.hypothesis;
      if (!h) return 'Tenho uma suspeita, mas ainda não consigo explicar qual.';
      const sure = percent(s.belief) ? ` (confiança de ${percent(s.belief)} por enquanto)` : '';
      if (h.source === 'desconhecida' || h.cause === 'desconhecida') {
        return `Também suspeito de algo que eu ainda não consigo medir${sure}.`;
      }
      if (h.source === 'rotina' || h.cause === 'rotina') {
        return `Suspeito que seja só a variação normal deste computador neste horário${sure}.`;
      }
      const sym = h.symptom ? ` de ${name(h.symptom)}` : '';
      return `Suspeito de ${name(h.cause)} como causa${sym}${sure}.`;
    },

    plano(s) {
      const p = s.prediction;
      if (!p) return 'Vou montar um jeito de testar isso.';
      const t = name(p.target);
      switch (p.action) {
        case 'lembrar': return `Vou conferir no meu histórico se ${expectation('lembrar', p.target, p.expect)}.`;
        case 'esperar': return `Vou ficar de olho: se a suspeita estiver certa, ${expectation('esperar', p.target, p.expect)}.`;
        case 'medir': return `Vou medir ${t}: se a suspeita estiver certa, ${expectation('medir', p.target, p.expect)}.`;
        case 'intervir': return `Vou mexer em ${t} e ver o que acontece: se a suspeita estiver certa, ${expectation('intervir', p.target, p.expect)}.`;
        default: return `Vou verificar ${t}.`;
      }
    },

    resultado(s) {
      const o = s.outcome;
      if (!o) return 'Terminei um passo, mas não consegui registrar o que vi.';
      if (o.observed === 'interrompido') {
        return `Parei o teste de ${name(o.target)} porque você voltou; esse teste não conta como evidência e eu refaço depois.`;
      }
      const p = s.prediction;
      const weak = o.significant === false ? ' A diferença foi pequena, então pesa pouco.' : '';
      if (!VOCAB.includes(o.observed)) return `Fiz o passo em ${name(o.target)}, mas não consegui classificar o que vi, então não tiro conclusão disso.`;
      const seen = expectation(o.action, o.target, o.observed);
      if (!p) return `Resultado: ${seen}.${weak}`;
      const hit = p.expect === o.observed;
      const lead = hit ? 'Bateu com o que eu esperava' : 'Não bateu com o que eu esperava';
      return `${lead}: ${seen}.${weak}`;
    },

    conclusao(s) {
      const v = s.verdict || {};
      const winner = v.winner ? name(causeOf(v.winner)) : '';
      const refuted = (v.refuted || []).map((k) => name(causeOf(k)));
      const list = (a) => a.join(', ').replace(/, ([^,]*)$/, ' e $1');
      const dropped = refuted.length ? ` Descartei ${list(refuted)}.` : '';
      switch (v.status) {
        case 'apoiada':
          return `Testei e confirmei: ${winner || 'a causa que eu suspeitava'} explica o que aconteceu.${dropped}`;
        case 'correlacionada':
          return `${winner || 'Uma causa'} aparece junto com o problema, mas só observei: ainda não fiz um teste que prove.${dropped}`;
        case 'nao-resolvido': {
          const missing = (s.missing || []).map(name);
          const gap = missing.length ? ` Faltou medir ${list(missing)}.` : ' Faltou medir o que está fora do meu alcance hoje.';
          const drop = refuted.length ? `Descartei ${list(refuted)}.` : 'Não consegui descartar nenhuma causa.';
          return `Não consegui resolver este caso. ${drop}${gap}`;
        }
        default:
          return `Ainda não tenho uma resposta: continuo investigando.${dropped}`;
      }
    },

    necessidade(s) {
      const what = s.signal ? ` de medir ${name(s.signal)}` : ' de mais informação';
      const why = s.reason ? `: ${str(s.reason)}` : '';
      return ending(`Preciso${what}${why}`);
    },

    pedido(s) {
      const sig = s.signal ? ` para olhar ${name(s.signal)}` : '';
      const mins = finite(s.minutes) ? ` (uns ${num(s.minutes)} min)` : '';
      const text = (str(s.text) || 'me ajude com um teste').trim().replace(/[.!?…]+$/, '');
      return `Um pedido: ${text}${sig}${mins}. Só assim consigo continuar.`;
    },

    ritmo(s) {
      const why = s.reason ? `: ${str(s.reason)}` : '';
      if (s.state === 'profundo') return ending(`Passei ao ritmo profundo${why}`);
      return ending(`Voltei ao ritmo leve${why}`);
    },

    interrompido(s) {
      const t = s.target ? ` de ${name(s.target)}` : '';
      return `Cortei o teste${t} porque você voltou. Ele não conta como evidência e eu refaço quando o computador estiver livre.`;
    }
  };

  /** Uma frase em português para o passo; nunca lança. */
  function say(step) {
    try {
      const fn = step && SAY[step.type];
      if (!fn) return 'Fiz um passo de raciocínio que ainda não sei contar direito.';
      return fn(step);
    } catch (_) {
      return 'Fiz um passo de raciocínio que ainda não sei contar direito.';
    }
  }

  return { say };
});
