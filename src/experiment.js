/*
 * Estatística do experimento A/B. Regra de ouro: só afirmar melhora quando a diferença supera o ruído medido.
 * Funções puras; o benchmark em si roda no processo principal.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NexoExperiment = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const clean = (values) => (values || []).filter((value) => finite(value) && value > 0);

  function median(values) {
    const sorted = clean(values).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  /** Resumo de repetições: mediana e ruído (meia amplitude em % da mediana). */
  function summarize(values) {
    const list = clean(values);
    if (!list.length) return { n: 0, median: null, min: null, max: null, noisePct: null };
    const mid = median(list);
    const min = Math.min(...list);
    const max = Math.max(...list);
    return { n: list.length, median: mid, min, max, noisePct: ((max - min) / 2 / mid) * 100 };
  }

  /**
   * Compara A (antes) com B (depois). `minEffectPct` é o menor efeito que vale a pena reportar.
   * Retorna: verdict (melhorou | piorou | sem-diferenca | inconclusivo), deltaPct, noisePct, confidence e notas.
   */
  function compare(before, after, { minEffectPct = 2, minRepetitions = 3 } = {}) {
    const a = summarize(before);
    const b = summarize(after);
    const notes = [];
    if (a.n < minRepetitions || b.n < minRepetitions) {
      return { verdict: 'inconclusivo', deltaPct: null, noisePct: null, confidence: 'nenhuma', a, b, notes: [`São necessárias ao menos ${minRepetitions} repetições por lado.`] };
    }
    const deltaPct = ((b.median - a.median) / a.median) * 100;
    const noisePct = Math.max(a.noisePct, b.noisePct);
    const threshold = Math.max(minEffectPct, noisePct);
    const ratio = noisePct > 0 ? Math.abs(deltaPct) / noisePct : Infinity;
    let verdict;
    if (Math.abs(deltaPct) <= threshold) verdict = 'sem-diferenca';
    else verdict = deltaPct > 0 ? 'melhorou' : 'piorou';
    if (noisePct > 8) notes.push('As medições variaram muito entre repetições (acima de 8%). Feche outros programas e repita para um resultado mais confiável.');
    const confidence = verdict === 'sem-diferenca' ? 'n/a' : ratio >= 3 ? 'alta' : ratio >= 2 ? 'média' : 'baixa';
    if (verdict === 'sem-diferenca') notes.push('A diferença ficou dentro do ruído da medição: neste teste, não há efeito mensurável.');
    return { verdict, deltaPct, noisePct, confidence, a, b, notes };
  }

  /** Mediana de valores com sinal (as razões por par podem ser negativas). */
  function signedMedian(values) {
    const sorted = (values || []).filter(finite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  /**
   * Comparação PAREADA e intercalada: cada medição de B foi feita logo ao lado de uma de A (ordem A-B, B-A, A-B…),
   * então o aquecimento do processador ao longo do teste afeta os dois lados igual. Ganho = mediana das razões por par;
   * ruído = quanto os pares discordam entre si. Só afirma diferença acima do ruído e com a maioria dos pares concordando.
   */
  function comparePaired(before, after, { minEffectPct = 2, minPairs = 3, maxNoisePct = 10 } = {}) {
    const a = summarize(before);
    const b = summarize(after);
    const pairs = [];
    for (let i = 0; i < Math.min((before || []).length, (after || []).length); i += 1) {
      if (finite(before[i]) && finite(after[i]) && before[i] > 0 && after[i] > 0) pairs.push((after[i] / before[i] - 1) * 100);
    }
    if (pairs.length < minPairs) return { verdict: 'inconclusivo', deltaPct: null, noisePct: null, confidence: 'nenhuma', a, b, pairs: pairs.length, notes: [`São necessários ao menos ${minPairs} pares de medições.`] };
    const deltaPct = signedMedian(pairs);
    const noisePct = (Math.max(...pairs) - Math.min(...pairs)) / 2;
    const sign = Math.sign(deltaPct);
    const consistency = sign === 0 ? 0 : pairs.filter((value) => Math.sign(value) === sign).length / pairs.length;
    const threshold = Math.max(minEffectPct, noisePct);
    const notes = [];
    let verdict = 'sem-diferenca';
    if (noisePct > maxNoisePct) {
      verdict = 'inconclusivo';
      notes.push('As medições variaram muito de um par para outro (outro programa pode ter usado o processador). Feche o que estiver aberto e repita.');
    } else if (Math.abs(deltaPct) > threshold && consistency >= 0.75) verdict = deltaPct > 0 ? 'melhorou' : 'piorou';
    else notes.push('A diferença ficou dentro do ruído da medição: neste teste, não há efeito mensurável.');
    const ratio = noisePct > 0 ? Math.abs(deltaPct) / noisePct : Infinity;
    let confidence = 'n/a';
    if (verdict === 'melhorou' || verdict === 'piorou') confidence = consistency === 1 && ratio >= 2 ? 'alta' : 'média';
    return { verdict, deltaPct, noisePct, confidence, consistency, a, b, pairs: pairs.length, notes };
  }

  /** Avisos de contexto que podem distorcer a comparação (temperatura, carga alheia, bateria). */
  function contextWarnings({ onBattery = false, cpuBefore = null, tempBefore = null, tempAfter = null } = {}) {
    const warnings = [];
    if (onBattery) warnings.push('O computador está na bateria: o Windows limita o desempenho e o teste consome energia.');
    if (finite(cpuBefore) && cpuBefore >= 50) warnings.push('O processador já estava ocupado antes do teste; o resultado pode ser influenciado por outros programas.');
    if (finite(tempBefore) && finite(tempAfter) && tempAfter - tempBefore >= 8) warnings.push(`A temperatura subiu ${Math.round(tempAfter - tempBefore)} °C entre as fases; parte da diferença pode ser térmica.`);
    return warnings;
  }

  return { median, summarize, compare, comparePaired, contextWarnings };
});
