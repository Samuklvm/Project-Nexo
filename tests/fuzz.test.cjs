/*
 * Testes de "força bruta": milhares de entradas aleatórias (com semente fixa, reproduzíveis) contra as travas de
 * segurança. A ideia é achar o caso que ninguém pensou: um valor fora do catálogo passando, uma aspa escapando no
 * script elevado, um veredito de ganho com dados iguais.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Lab = require('../src/lab.js');
const Scan = require('../electron/system-scan.cjs');
const Elevate = require('../electron/elevate.cjs');
const RT = require('../src/reboot-test.js');

function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (random, list) => list[Math.floor(random() * list.length)];
const JUNK = [null, undefined, -1, 0.5, 1e12, NaN, Infinity, '', "'", "1'; Remove-Item C:\\ -Recurse; '", '$(calc)', '`whoami`', '"', '\\', 'a'.repeat(500), [], {}, true, '0x26', ' 38', '38 ', 4294967296];

test('laboratório: ideias sorteadas respeitam risco, faixa do PC, original e um valor por ajuste', () => {
  const random = rng(42);
  const risks = ['baixo', 'moderado', 'alto'];
  for (let round = 0; round < 300; round += 1) {
    const baseline = {};
    const support = {};
    for (const knob of Lab.SPACE) {
      if (random() < 0.15) continue; // ajuste que não existe neste PC
      baseline[knob.id] = random() < 0.7 ? pick(random, knob.values) : Math.floor(random() * 200);
      if (random() < 0.3) support[knob.id] = { indexes: knob.values.filter(() => random() < 0.6) };
      else if (random() < 0.2) support[knob.id] = { min: 0, max: Math.floor(random() * 100) };
    }
    const allowRisk = pick(random, risks);
    const count = 1 + Math.floor(random() * 40);
    const hybrid = random() < 0.5 ? false : null;
    const benchSupport = { network: random() < 0.5 };
    const picked = Lab.chooseCandidates({ baseline, support, allowRisk, count, hybrid, benchSupport });
    assert.ok(picked.length <= count);
    const rank = { baixo: 1, moderado: 2, alto: 3 };
    for (const arm of picked) {
      const knob = Lab.knob(arm.knob);
      assert.ok(rank[knob.risk] <= rank[allowRisk], `${arm.key} acima do risco ${allowRisk}`);
      assert.notEqual(arm.value, baseline[arm.knob], `${arm.key} igual ao original`);
      assert.ok(Lab.supportedValues(knob, support[arm.knob]).includes(arm.value), `${arm.key} fora da faixa do PC`);
      assert.ok(!(knob.hybrid && hybrid === false), `${arm.key} é de núcleo híbrido num PC sem núcleos híbridos`);
      assert.doesNotThrow(() => Lab.validateStep(arm.knob, arm.value, baseline[arm.knob]));
    }
    // Só repete um ajuste (outro valor dele) depois de usar todos os ajustes possíveis neste PC.
    const eligible = new Set(Lab.chooseCandidates({ baseline, support, allowRisk, count: 100000, hybrid, benchSupport }).map((arm) => arm.knob));
    const distinct = new Set(picked.map((arm) => arm.knob)).size;
    assert.equal(distinct, Math.min(eligible.size, picked.length), `repetiu ajuste cedo: ${distinct} de ${picked.length} (${eligible.size} possíveis)`);
  }
});

test('laboratório: validateStep recusa qualquer valor fora do espaço (exceto o original para voltar)', () => {
  const random = rng(7);
  for (let i = 0; i < 4000; i += 1) {
    const knob = pick(random, Lab.SPACE);
    const value = random() < 0.5 ? pick(random, JUNK) : Math.floor(random() * 5000) - 100;
    const inside = knob.values.includes(value);
    if (inside) assert.doesNotThrow(() => Lab.validateStep(knob.id, value, null));
    else assert.throws(() => Lab.validateStep(knob.id, value, null), Lab.GuardError);
  }
  assert.throws(() => Lab.validateStep('../../perfepp', 0, null), Lab.GuardError);
});

test('laboratório: memória adulterada do navegador nunca entra crua no motor', () => {
  const random = rng(99);
  for (let i = 0; i < 500; i += 1) {
    const evidence = {};
    for (let j = 0; j < 30; j += 1) {
      const knob = pick(random, Lab.SPACE);
      const key = random() < 0.5 ? `${knob.id}=${pick(random, knob.values)}` : random() < 0.5 ? `combo:${knob.id}=${knob.values[0]}+${pick(random, Lab.SPACE).id}=1` : String(pick(random, JUNK));
      evidence[key] = random() < 0.2 ? pick(random, JUNK) : { n: pick(random, [1, -5, 1e9, NaN, '3']), mean: pick(random, [2, 1e9, -1e9, NaN, '9']), lastVerdict: pick(random, ['ganho', 'x'.repeat(99), 5]) };
    }
    const tabu = Array.from({ length: 300 }, () => (random() < 0.5 ? `${pick(random, Lab.SPACE).id}=0` : pick(random, JUNK)));
    const clean = Lab.sanitizeMemory(evidence, tabu);
    assert.ok(clean.tabu.length <= 256);
    for (const [key, item] of Object.entries(clean.evidence)) {
      assert.ok(item.n >= 0 && item.n <= 1000, key);
      assert.ok(item.mean >= -100 && item.mean <= 100, key);
      assert.ok(item.lastVerdict === null || item.lastVerdict.length <= 20);
    }
    assert.doesNotThrow(() => Lab.chooseCandidates({ baseline: { perfepp: 33, boostmode: 1 }, evidence: clean.evidence, tabu: clean.tabu, count: 8, allowRisk: 'alto' }));
  }
});

test('Raio-X: nenhum valor aleatório passa pela validação se não for do catálogo', () => {
  const random = rng(2024);
  let accepted = 0;
  for (let i = 0; i < 6000; i += 1) {
    const tweak = pick(random, Scan.TWEAKS);
    const values = tweak.entries.map(() => (random() < 0.3 ? pick(random, pick(random, tweak.options).values) : pick(random, JUNK)));
    if (random() < 0.1) values.push(1);
    const change = { id: random() < 0.05 ? pick(random, JUNK) : tweak.id, values };
    let ok = false;
    try { Scan.validateChange(change); ok = true; } catch (error) { assert.ok(error instanceof Error); }
    if (ok) {
      accepted += 1;
      assert.ok(tweak.options.some((option) => JSON.stringify(option.values) === JSON.stringify(values)), `aceitou ${tweak.id} ${JSON.stringify(values)}`);
    }
  }
  assert.ok(accepted > 0, 'o sorteio também precisa acertar opções válidas');
});

test('Raio-X: reversão só aceita valores do tipo certo, sem aspas nem comandos', () => {
  const random = rng(5);
  for (let i = 0; i < 4000; i += 1) {
    const tweak = pick(random, Scan.TWEAKS);
    const values = tweak.entries.map(() => pick(random, JUNK));
    let ok = false;
    try { Scan.validateChange({ id: tweak.id, values, revert: true }); ok = true; } catch { ok = false; }
    if (!ok) continue;
    tweak.entries.forEach((entry, index) => {
      const value = values[index];
      if (entry.kind === 'power') assert.ok(Number.isInteger(value) && value >= 0);
      else if (value !== null) {
        if (entry.type === 'dword') assert.ok(Number.isInteger(value) && value >= 0 && value <= Scan.DWORD_MAX);
        else assert.match(value, /^[A-Za-z0-9 _.\-=;]{0,200}$/);
      }
    });
  }
});

test('Raio-X: script elevado de seleções aleatórias só tem caminhos do catálogo e aspas balanceadas', () => {
  const random = rng(77);
  const hklm = Scan.TWEAKS.filter((tweak) => tweak.entries.some((entry) => entry.hive === 'HKLM'));
  const allowedPaths = new Set(hklm.flatMap((tweak) => tweak.entries.filter((entry) => entry.hive === 'HKLM').map((entry) => `HKLM:\\${entry.key}`)));
  for (let round = 0; round < 200; round += 1) {
    const chosen = hklm.filter(() => random() < 0.3);
    if (!chosen.length) continue;
    const changes = chosen.map((tweak) => ({ id: tweak.id, values: pick(random, tweak.options).values, revert: false }));
    const body = Elevate.TASKS['registry-tweaks']({ changes });
    for (const line of body.split('\n')) assert.equal((line.match(/'/g) || []).length % 2, 0, `aspas desbalanceadas: ${line}`);
    assert.doesNotMatch(body, /HKCU|Invoke-Expression|\biex\b|DownloadString|-Verb/);
    const { prelude } = Scan.elevatedBody(changes);
    const table = prelude.find((line) => line.startsWith('$P = @('));
    const prefixes = Object.fromEntries(prelude.filter((line) => /^\$[A-Z] = '/.test(line)).map((line) => [line.slice(0, 2), line.match(/'(.*)'/)[1]]));
    const paths = [...table.matchAll(/\((\$[A-Z]) \+ '([^']*)'\)|'([^']*)'/g)].map((match) => (match[1] ? prefixes[match[1]] + match[2] : match[3]));
    for (const item of paths) assert.ok(allowedPaths.has(item), `caminho fora do catálogo: ${item}`);
    assert.ok(Elevate.encode(body).length < 32000);
  }
});

test('teste com reinício: dados iguais nunca viram "ganho"; qualquer boot sorteado dá um veredito válido', () => {
  const random = rng(31337);
  for (let round = 0; round < 400; round += 1) {
    const protocol = pick(random, Object.keys(RT.PROTOCOLS));
    let state = RT.createPlan({ changes: [{ id: 'priosep', before: [2], after: [38] }], protocol, goal: pick(random, Object.keys(RT.GOALS)), now: 1 });
    const same = random() < 0.5;
    const base = Object.fromEntries(RT.METRICS.map((metric) => [metric.id, 1 + random() * 1000]));
    for (const config of state.order) {
      const metrics = {};
      for (const metric of RT.METRICS) {
        if (random() < 0.1) continue;
        metrics[metric.id] = same ? base[metric.id] * (1 + (random() - 0.5) * 0.04) : random() < 0.05 ? pick(random, JUNK) : base[metric.id] * (0.5 + random());
      }
      state = RT.recordBoot(state, { metrics, rounds: {}, quiet: random() > 0.1 }, 2);
    }
    const result = RT.verdict(state);
    assert.ok(['ganho', 'perda', 'misto', 'empate', 'inconclusivo'].includes(result.overall));
    assert.ok(['A', 'B'].includes(result.keep));
    assert.equal(result.keep === 'B', result.overall === 'ganho');
    if (same) assert.notEqual(result.overall, 'ganho', 'variação de ±2% com configurações iguais virou ganho');
    for (const metric of result.metrics) assert.ok(metric.gainPct === null || Number.isFinite(metric.gainPct));
  }
});
