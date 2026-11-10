/*
 * Programas do sistema pelo CAMINHO COMPLETO (C:\Windows\System32\…, /bin/sh), nunca procurados no PATH: uma pasta
 * gravável no PATH com um "powershell.exe" falso não consegue se passar pelo do Windows.
 */
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

module.exports = { systemTool, WINDOWS_TOOLS };
