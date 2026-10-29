const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..', '..');
const launcherDir = path.resolve(__dirname, '..');
const project = require(path.join(projectDir, 'package.json'));
const launcher = require(path.join(launcherDir, 'package.json'));

if (launcher.version !== project.version) {
  throw new Error(`Launcher ${launcher.version} must match app ${project.version}.`);
}

const setupName = `Nexo-Setup-${project.version}.exe`;
const setupPath = path.join(projectDir, 'release', setupName);
if (!fs.existsSync(setupPath)) {
  throw new Error(`Missing ${setupPath}. Build the main Windows installer first.`);
}

const noticesPath = path.join(projectDir, 'installer', 'AVISOS.txt');
if (!fs.existsSync(noticesPath)) {
  throw new Error(`Missing product notices: ${noticesPath}`);
}

const payloadDir = path.join(launcherDir, 'payload');
fs.mkdirSync(payloadDir, { recursive: true });
fs.copyFileSync(setupPath, path.join(payloadDir, 'Nexo-Setup.exe'));
fs.copyFileSync(noticesPath, path.join(payloadDir, 'AVISOS.txt'));
console.log(`Prepared ${setupName} and AVISOS.txt for the visual installer.`);
