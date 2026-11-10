const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const L = require('../electron/linux.cjs');
const { parseMangoChunk, createMangoRunner, launchOption } = require('../electron/mangohud.cjs');
const { createLinuxLabSystem } = require('../electron/lab-linux.cjs');
const Lab = require('../src/lab.js');
const Games = require('../electron/games.cjs');
const Session = require('../src/session.js');
const Elevate = require('../electron/elevate.cjs');

test('unidades: só sistemas de arquivos reais, sem snap/efi, sem repetir o mesmo disco (btrfs)', () => {
  const mounts = L.parseMounts([
    '/dev/nvme0n1p2 / btrfs rw,subvol=/@ 0 0', '/dev/nvme0n1p2 /home btrfs rw,subvol=/@home 0 0', '/dev/nvme0n1p1 /boot/efi vfat rw 0 0',
    'tmpfs /tmp tmpfs rw 0 0', '/dev/loop3 /snap/core/1 squashfs ro 0 0', '/dev/sda1 /mnt/Jogos\\040Steam ext4 rw 0 0', 'proc /proc proc rw 0 0'].join('\n'));
  assert.deepEqual(mounts.map((item) => item.mount), ['/', '/mnt/Jogos Steam']);
});

test('/proc/<pid>/stat com espaços e parênteses no nome', () => {
  const stat = L.parseStat('4242 (Web Content (x)) S 1 4242 4242 0 -1 4194560 100 0 0 0 1500 250 0 0 20 0 30 0 1000 900000000 51200 18446744073709551615');
  assert.equal(stat.pid, 4242);
  assert.equal(stat.name, 'Web Content (x)');
  assert.equal(stat.ticks, 1750);
  assert.equal(stat.rssPages, 51200);
});

test('powerprofilesctl, .desktop e xprop', () => {
  const profiles = L.parseProfiles('  performance:\n    CpuDriver:\tamd_pstate\n\n* balanced:\n    CpuDriver:\tamd_pstate\n\n  power-saver:\n    CpuDriver:\tamd_pstate\n');
  assert.deepEqual(profiles.map((profile) => [profile.guid, profile.active]), [['power-saver', false], ['balanced', true], ['performance', false]]);
  assert.equal(profiles[1].name, 'Equilibrado');
  const desktop = L.parseDesktop('[Desktop Entry]\nName=Discord\nName[pt_BR]=Discord BR\nExec=/usr/bin/discord --start-minimized\n[Desktop Action x]\nName=Outro');
  assert.equal(desktop.Name, 'Discord');
  assert.equal(desktop.Exec, '/usr/bin/discord --start-minimized');
  assert.equal(L.parseActiveWindow('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007'), '0x3a00007');
  assert.equal(L.parseActiveWindow('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0'), null);
  assert.equal(L.parseWmPid('_NET_WM_PID(CARDINAL) = 5150'), 5150);
  assert.equal(L.hwmonType('k10temp'), 'Cpu');
  assert.equal(L.hwmonType('amdgpu'), 'GpuAmd');
  assert.equal(L.hwmonType('nvme'), 'Storage');
});

test('jogos no Linux: pastas da Steam (inclusive Proton) e do Heroic contam como jogo', () => {
  assert.equal(Session.classifyForeground({ name: 'wine64-preloader', path: '/home/a/.local/share/Steam/steamapps/common/Hades/jogo' }).isGame, true);
  assert.equal(Session.classifyForeground({ name: 'game', path: '/home/a/Games/Heroic/Hollow/game' }).isGame, true);
  assert.equal(Session.classifyForeground({ name: 'steam', path: '/home/a/.local/share/Steam/ubuntu12_32/steam' }).isGame, false);
  assert.equal(Session.classifyForeground({ name: 'firefox', path: '/usr/lib/firefox/firefox' }).isGame, false);
});

test('MangoHud: lê só o bloco de quadros, em pedaços, e soma o FPS', async () => {
  const log = 'os,cpu,gpu,ram,kernel,driver,cpuscheduler\nArch,Ryzen,RX 6600,32GB,6.11,Mesa,\nfps,frametime,cpu_load,gpu_load,cpu_temp,gpu_temp,elapsed\n';
  let parsed = parseMangoChunk(log + '60,16.6,30,90,60,70,1\n120,8.3,', { header: null, rest: '' });
  assert.deepEqual(parsed.frames, [{ ms: 16.6 }]);
  parsed = parseMangoChunk('30,90,60,70,2\n', parsed.state);
  assert.deepEqual(parsed.frames, [{ ms: 8.3 }]);
  assert.match(launchOption('/home/a/.config/Nexo/mangohud'), /output_folder=\/home\/a\/\.config\/Nexo\/mangohud/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-mango-'));
  const events = [];
  let clock = Date.now();
  const runner = createMangoRunner({ fs: fsp, path, dir, emit: (channel, payload) => events.push([channel, payload]), now: () => clock, interval: 60000 });
  await runner.start();
  const file = path.join(dir, 'Hades_2026-11-05_16-30-00.csv');
  fs.writeFileSync(file, log + Array.from({ length: 300 }, (_, index) => `${index % 50 === 0 ? 30 : 120},${index % 50 === 0 ? 33.3 : 8.3},1,1,1,1,${index}`).join('\n') + '\n');
  clock += 1500;
  await runner.poll();
  assert.equal(events[0][0], 'fps:update');
  const result = await runner.stop();
  assert.equal(result.frames, 300);
  assert.ok(result.summary.avgFps > 100 && result.summary.avgFps < 125);
  assert.ok(result.summary.p1LowFps < 40);
});

test('laboratório no Linux: perfis de energia, sem root, trava e volta ao original', async () => {
  const state = { active: 'balanced', sets: [] };
  const linux = { PROFILES: L.PROFILES, PROFILE_ORDER: L.PROFILE_ORDER, powerProfiles: async () => L.PROFILE_ORDER.map((guid) => ({ guid, name: L.PROFILES[guid], active: guid === state.active })), setPowerProfile: async (id) => { state.sets.push(id); state.active = id; } };
  const files = new Map();
  const memfs = { mkdir: async () => {}, writeFile: async (f, d) => files.set(f, d), readFile: async (f) => { if (!files.has(f)) { throw new Error('x'); } return files.get(f); }, rm: async (f) => files.delete(f) };
  let t = 0;
  const system = createLinuxLabSystem({ linux, run: async () => ({ code: 0, stdout: '' }), bench: async (mode) => ({ mopsPerSec: (state.active === 'performance' && mode === 'burst' ? 110 : 100) * (1 + (t % 7) / 1000) }), readTemp: async () => 50, cpuLoad: async () => 5, onBattery: async () => false, fs: memfs, path, dir: '/lab', now: () => { t += 500; return t; }, sleep: async () => {} });
  const result = await Lab.run(system, { consent: { acknowledged: true, phrase: 'ENTENDO O RISCO' }, autonomy: 'autonomo', limits: { pairs: 3, confirmPairs: 5 } });
  assert.equal(result.status, 'completed');
  assert.ok(result.arms.some((arm) => arm.key === 'ppd=2' && arm.verdict === 'melhorou'));
  assert.equal(result.adopted.guid, 'performance');
  assert.equal(result.adopted.before.guid, 'balanced');
  assert.equal(files.size, 0, 'trava removida');
  assert.ok(state.sets.every((id) => L.PROFILE_ORDER.includes(id)));
  await assert.rejects(system.apply([{ id: 'perfepp', sub: 'SUB_PROCESSOR', setting: 'PERFEPP', value: 0 }]));
});

test('biblioteca no Linux: Steam em ~/.local/share/Steam e Heroic (Epic e GOG)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexo-home-'));
  const steam = path.join(home, '.local', 'share', 'Steam');
  fs.mkdirSync(path.join(steam, 'steamapps', 'common', 'Celeste'), { recursive: true });
  fs.writeFileSync(path.join(steam, 'steamapps', 'appmanifest_504230.acf'), '"AppState" { "appid" "504230" "name" "Celeste" "StateFlags" "4" "installdir" "Celeste" }');
  const heroic = path.join(home, '.config', 'heroic');
  fs.mkdirSync(path.join(heroic, 'legendaryConfig', 'legendary'), { recursive: true });
  fs.mkdirSync(path.join(heroic, 'gog_store'), { recursive: true });
  fs.writeFileSync(path.join(heroic, 'legendaryConfig', 'legendary', 'installed.json'), JSON.stringify({ Fortnite: { title: 'Fortnite', install_path: '/home/a/Games/Heroic/Fortnite', install_size: 10 } }));
  fs.writeFileSync(path.join(heroic, 'gog_store', 'installed.json'), JSON.stringify({ installed: [{ appName: '1207658924', install_path: '/home/a/Games/Heroic/Witcher' }] }));
  fs.writeFileSync(path.join(heroic, 'gog_store', 'library.json'), JSON.stringify({ games: [{ app_name: '1207658924', title: 'The Witcher' }] }));
  const library = Games.createLibrary({ fs: fsp, path, platform: 'linux', env: { HOME: home }, coversDir: path.join(home, 'covers'), manualFile: path.join(home, 'm.json'), runPowerShell: async () => { throw new Error('não deveria chamar PowerShell no Linux'); } });
  const list = await library.scan();
  assert.deepEqual(list.map((game) => game.name).sort(), ['Celeste', 'Fortnite', 'The Witcher']);
  assert.equal(list.find((game) => game.name === 'Celeste').canLaunch, true);
  assert.equal(library.matchPath('/home/a/Games/Heroic/Witcher/bin/witcher')?.name, 'The Witcher');
});

test('Linux: pkexec só com comandos fixos e caminho de montagem validado', () => {
  assert.deepEqual(Elevate.linuxPrivileged('fstrim', '/'), ['pkexec', ['fstrim', '-v', '/']]);
  assert.deepEqual(Elevate.linuxPrivileged('fstrim', '/mnt/Jogos Steam'), ['pkexec', ['fstrim', '-v', '/mnt/Jogos Steam']]);
  assert.throws(() => Elevate.linuxPrivileged('fstrim', '/; rm -rf /'));
  assert.throws(() => Elevate.linuxPrivileged('fstrim', '/mnt/../etc'));
  assert.throws(() => Elevate.linuxPrivileged('bash'));
});

test('Linux de verdade (esta máquina de testes): /proc, montagens e sensores respondem sem quebrar', { skip: process.platform !== 'linux' }, async () => {
  const run = (file, args) => new Promise((resolve) => { require('node:child_process').execFile(file, args, (error, stdout) => resolve({ code: error ? 1 : 0, stdout: String(stdout || '') })); });
  const linux = L.createLinux({ fs: fsp, path, os, run });
  const drives = await linux.drives();
  assert.ok(Array.isArray(drives));
  const top = await linux.topProcesses(200);
  assert.ok(top.byMemory.length > 0);
  const sensors = await linux.sensors();
  assert.ok(['ready', 'unavailable'].includes(sensors.status));
});
