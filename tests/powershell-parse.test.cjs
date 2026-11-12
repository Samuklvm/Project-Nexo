/*
 * No Windows (o build da release roda aqui), confere a sintaxe de cada script PowerShell que o app executa, sem
 * executar nenhum: o analisador do próprio PowerShell só lê o texto. Fora do Windows, o teste é pulado.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function scripts() {
  const out = {};
  const take = (prefix, mod) => { for (const [key, value] of Object.entries(mod)) if (typeof value === 'string' && /(SCRIPT|PRELUDE|EPILOGUE|INFO|PS_HEAD)$/.test(key) && value.trim()) out[`${prefix}.${key}`] = value; };
  take('deep-scan', require('../electron/deep-scan.cjs'));
  take('net-doctor', require('../electron/net-doctor.cjs'));
  take('optimizer-actions', require('../electron/optimizer-actions.cjs'));
  try { take('optimizer-system', require('../electron/optimizer-system.cjs')); } catch { /* módulo sem scripts exportados */ }
  // O lote elevado do otimizador, montado com um exemplo de cada tipo de mudança (o mesmo do teste do otimizador).
  out['elevate.optimizerBatchBody'] = require('../electron/elevate.cjs').optimizerBatchBody({
    restorePoint: true,
    registry: [{ id: 'hags', values: [2] }, { id: 'lastaccess', values: [0x80000001] }],
    changes: [
      { id: 'c1', kind: 'startup', source: 'machine-run', name: "O'Neil Tool", value: '03000000AABBCCDDEEFF0011' },
      { id: 'c2', kind: 'priority', exe: 'RobloxPlayerBeta.exe', value: 3 },
      { id: 'c3', kind: 'qos', exe: 'RobloxPlayerBeta.exe', on: true, nla: null },
      { id: 'c4', kind: 'nic', guid: '{11111111-2222-3333-4444-555555555555}', keyword: '*EEE', value: '0' },
      { id: 'c5', kind: 'pagefile', auto: true }
    ]
  });
  return out;
}

test('PowerShell: todos os scripts do app são válidos para o analisador do Windows', { skip: process.platform !== 'win32' && 'só no Windows' }, () => {
  const list = scripts();
  assert.ok(Object.keys(list).length >= 6, 'achou os scripts');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-ps-'));
  try {
    const files = Object.entries(list).map(([name, code], index) => { const file = path.join(dir, `s${index}.ps1`); fs.writeFileSync(file, code, 'utf8'); return [name, file]; });
    const checker = String.raw`
$result = @{}
foreach ($pair in ($env:NEXO_FILES -split ';')) {
  $name, $file = $pair -split '\|', 2
  $tokens = $null; $errors = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
  $result[$name] = @($errors | ForEach-Object { $_.Message + ' (linha ' + $_.Extent.StartLineNumber + ')' })
}
[Console]::Out.Write(($result | ConvertTo-Json -Depth 3 -Compress))`;
    const output = execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', checker], { env: { ...process.env, NEXO_FILES: files.map(([name, file]) => `${name}|${file}`).join(';') }, encoding: 'utf8', windowsHide: true, timeout: 120000 });
    const parsed = JSON.parse(output.slice(output.indexOf('{')));
    const broken = Object.entries(parsed).filter(([, errors]) => Array.isArray(errors) ? errors.length : errors);
    assert.deepEqual(broken, [], `scripts com erro de sintaxe: ${JSON.stringify(broken)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
