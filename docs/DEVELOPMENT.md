# For developers

[Português](DESENVOLVIMENTO.md) · English

## Run in development

**Windows:** Node.js 20 or later and the .NET 10 SDK (to build the sensor collector).

```powershell
npm install
npm run build:sensors
npm start
```

**Linux:** Node.js 20 or later. The .NET collector is not used: sensors come from the kernel.

```bash
npm install
npm start
```

Other commands:

```bash
npm test          # tests for the analysis engine, sessions, FPS, IPC, lab, library, connections and Linux
npm run preview   # builds dev/preview.html: the interface in a browser, with sample data
```

Technical overview, contracts and phase plan (in Portuguese): [ARQUITETURA.md](ARQUITETURA.md).

## Build the installers

| Command | Output |
|---|---|
| `npm run dist` | `release/Nexo-Setup-X.exe` (NSIS). This is what the auto-updater uses. |
| `npm run build:launcher` | `installer-launcher/dist/Nexo-Instalador-X.exe`, the visual installer (artwork, options, notices, PT/EN). It bundles `Nexo-Setup` and runs it silently. Run it after `npm run dist`. |
| `npm run dist:linux` | AppImage and `.deb` (run on Linux). |

Privacy and notices appear in the visual installer and in the NSIS wizard. Sharing with the creator starts turned off.

## Publish a version

1. Change `version` in `package.json`, `package-lock.json` and `installer-launcher/package.json`.
2. Write the notes in `docs/releases/vX.Y.Z.md` (Portuguese first, then English) and update `CHANGELOG.md`.
3. Create the `vX.Y.Z` tag (on GitHub, under **Releases → Draft a new release**, or with `git push origin vX.Y.Z`).

The GitHub Action checks that the tag matches the version, runs the tests, builds the .NET collector, publishes `Nexo-Setup` and the visual installer (Windows) plus the AppImage and `.deb` (Linux) to the same release, and uses `docs/releases/vX.Y.Z.md` as the release notes.

The installed app checks for updates at startup and only downloads when the user asks. The updater only works in the packaged app, and the repository and releases must be public.

### Repository secrets (Settings → Secrets and variables → Actions)

| Secret | Purpose |
|---|---|
| `GOOGLE_OAUTH_JSON` | Google OAuth “Desktop app” client: the JSON or just the `GOCSPX-…` secret (the public ID lives in `config/google-client.json`). See [LOGIN_GOOGLE.md](LOGIN_GOOGLE.md) (in Portuguese). |
| `NEXO_INTEGRATIONS_JSON` | Optional: `{"xboxClientId":"…"}` for Xbox sign-in. Discord already ships with the official app built in. See [CONEXOES.md](CONEXOES.md) (in Portuguese). |
| `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` | Optional: Authenticode certificate (`.pfx`) to sign the executables. Without them the release is unsigned. Sign the visual installer and the Setup with the same certificate, because an executable that silently runs another one tends to draw attention from antivirus software and SmartScreen. |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `NEXO_ADMIN_EMAILS` | Nexo server (sync, error reports and telemetry), published by the **Publicar servidor** workflow. See [SERVIDOR.md](SERVIDOR.md) (in Portuguese). |

## FPS: PresentMon (Windows)

FPS comes from **PresentMon** (Intel, MIT license), run as a separate program only when the user turns the option on in a session. The user must be in the **Performance Log Users** group (or Nexo must run as administrator). Nexo grants this when the user asks, through UAC, logs it in the Journal and lets the user revert it.

- **Version and integrity:** `third-party/presentmon.lock.json` stores the version and SHA-256. Until the hash is pinned, the build does not bundle the executable. To pin it: `npm run presentmon:hash`, compare it with the digest on the PresentMon release page and paste it into `sha256`. Meanwhile, **Sessões → Componentes → Escolher PresentMon…** (Sessions → Components → Choose PresentMon) accepts a file downloaded from the official site.
- Nexo only reads Windows events and injects nothing into the game. Anti-cheat compatibility has not been validated.

## Linux in detail

| Feature | Windows | Linux |
|---|---|---|
| Sensors | LibreHardwareMonitor (.NET sensor-host) | `/sys/class/hwmon`, `cpufreq`, `gpu_busy_percent` (AMD) and `nvidia-smi` |
| Programs and sessions | PowerShell and Windows counters | `/proc` and `xprop` (X11 and XWayland; on pure Wayland automatic game detection does not work) |
| FPS | PresentMon | MangoHud (Nexo reads its log; the launch option is ready in Sessions) |
| Power | Windows power plans (`powercfg`) | power-profiles-daemon profiles |
| Lab (beta) | 71 hidden power settings (processor, core parking, idle states, hybrid cores, SATA/NVMe, PCIe, Wi-Fi), 9 tests, novel combinations, restore point; PC X-ray of 109 settings (registry, services, active plan); reboot test (ABBA) | power profiles, no root |
| Cleanup | temp files, crash reports, WER, Recycle Bin | `/tmp`, thumbnails, apport reports, freedesktop Trash |
| Optimize drive | `defrag` (UAC) | `fstrim` (pkexec) |
| SFC, Performance Log Users, Xbox app games | yes | not available on Linux |

## Complete uninstall (Windows)

Through Windows Settings or the app's **Ajustes → Desinstalar o Nexo** (Settings → Uninstall Nexo), Nexo removes: the program, data and preferences (`%APPDATA%\nexo-device-care`, including covers, account and lab), caches and the updater cache (`%LOCALAPPDATA%`), shortcuts, the `HKCU\Software\NexoDeviceCare` key, Nexo's `Run`/`RunOnce` entries, power plans created by the lab and the uninstall entry. From the app, it also offers to remove the user from the Performance Log Users group and clears the traces Windows keeps about Nexo (MuiCache, UserAssist and Recent items). Updates do **not** delete data.

Out of reach for a program without administrator rights: Windows event logs, Prefetch and antivirus history. Restore points created before the lab stay with Windows.

## Limits

- Readings depend on the hardware, firmware and LibreHardwareMonitorLib. On Windows, processor and motherboard temperatures come from the `NexoSensors` service (collector with `--service`, PawnIO driver); without it, the collector runs as a normal process without those readings.
- The diagnosis points to possibilities, it does not prove causes, and Nexo **never ends processes**.
- Cleanup only removes regular files older than 7 days, skips links and stops at 5,000 files per run. Automatic cleanup only looks at the temp folder and requires four readings and 60 seconds with the disk above 90%, at most once per hour.
- In the browser (`npm run preview`), actions that depend on the computer use sample data.
