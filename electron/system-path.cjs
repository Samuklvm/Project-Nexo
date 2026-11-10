/*
 * Programas do sistema pelo CAMINHO COMPLETO (C:\Windows\System32\…, /bin/sh), nunca procurados no PATH: uma pasta
 * gravável no PATH com um "powershell.exe" falso não consegue se passar pelo do Windows.
 */
const fs = require('fs');
const path = require('path');

const WINDOWS_TOOLS = {
  powershell: ['WindowsPowerShell', 'v1.0', 'powershell.exe'], reg: ['reg.exe'], powercfg: ['powercfg.exe'], route: ['ROUTE.EXE'], taskmgr: ['Taskmgr.exe'],
  shutdown: ['shutdown.exe'], sc: ['sc.exe'], netsh: ['netsh.exe'], ipconfig: ['ipconfig.exe'], cmd: ['cmd.exe'], schtasks: ['schtasks.exe'], wevtutil: ['wevtutil.exe'], defrag: ['Defrag.exe'], sfc: ['sfc.exe']
};
const UNIX_TOOLS = { sh: '/bin/sh' };

function systemTool(name, { platform = process.platform, env = process.env } = {}) {
  const key = String(name).toLowerCase().replace(/\.exe$/, '');
  if (platform === 'win32' && Object.hasOwn(WINDOWS_TOOLS, key)) {
    const root = env.SystemRoot || env.windir || 'C:\\Windows';
    return path.win32.join(root, 'System32', ...WINDOWS_TOOLS[key]);
  }
  if (platform !== 'win32' && Object.hasOwn(UNIX_TOOLS, key)) return UNIX_TOOLS[key];
  return name;
}

/**
 * nvidia-smi pelo caminho em que o driver da NVIDIA o instala (também nunca pelo PATH): no Windows, o driver atual
 * põe em System32 e o antigo em Program Files\NVIDIA Corporation\NVSMI; no Linux, em /usr/bin. Sem nenhum, null
 * (PC sem placa ou sem driver da NVIDIA).
 */
function nvidiaSmi({ platform = process.platform, env = process.env, exists = (file) => fs.existsSync(file) } = {}) {
  const candidates = platform === 'win32'
    ? [path.win32.join(env.SystemRoot || env.windir || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
      path.win32.join(env.ProgramW6432 || env.ProgramFiles || 'C:\\Program Files', 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')]
    : ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi', '/bin/nvidia-smi'];
  return candidates.find((file) => exists(file)) || null;
}

module.exports = { systemTool, nvidiaSmi, WINDOWS_TOOLS };
