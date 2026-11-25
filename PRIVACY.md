# Nexo Device Care privacy

[Português](PRIVACIDADE.md)

The Portuguese version ([PRIVACIDADE.md](PRIVACIDADE.md)) is the reference text; this is its English translation.

## Summary

Nexo is free. The code is open source, under the GPL-3.0 license (see LICENSE). Local collection and processing are active to power the app's features and stay on the computer.

Nexo has a server for account sync, error reports and telemetry. Telemetry is optional and off by default. So the app can keep getting better, I ask you to turn it on. It produces one summary per day, so it is harmless, and it takes nothing personal: only what helps us understand how the app behaves on other machines, so we can improve Nexo. Sync and telemetry are turned on and off separately. The **usage count** (only “this PC opened today”, with a scrambled PC code) and **error reports start on** and can be turned off in Settings; they carry nothing personal, they exist so the app's problems get fixed, and the email in them is optional. The full inventory is under [Nexo server](#nexo-server). There are no ads.

## Local collection (active)

Local collection is part of how Nexo works and does not depend on consent for external sharing. The data below stays on the computer.

## Data processed on this computer

- **Dashboard:** computer name, Windows type/version, app version, uptime, CPU percentage, total/free/used RAM, a local connectivity indicator (yes/no) and total/free/used space of fixed drives, including letter, label and file system. Network addresses are examined only locally to compute the indicator and are never stored or sent by Nexo.
- **Sensors:** readings made available locally by the open LibreHardwareMonitorLib 0.9.6 library: CPU, AMD/NVIDIA/Intel GPU, memory, motherboard, storage, network, battery, power supply, power meters and compatible controllers. Depending on the hardware, they may include temperature, voltage, current, power, clock, frequency, load, fan, flow, level, data, throughput, duration, latency, energy, noise, conductivity and humidity, plus the session minimum and maximum. The collector does not read hardware/sensor identifier fields, serial numbers or MAC addresses; component and sensor names are the names provided by the library, which may include the model. Components without support or access show an unavailable reading.
- **Diagnostics:** PID, name and CPU/memory use of the heaviest programs are read locally to build suggestions. The app does not end these processes. During a sustained slowdown, **only the name** of the program that led the usage is stored in the local learning (never the path, the command line or the content).
- **Cleanup and optimization:** paths, sizes and counts of old regular files (the user's temp folder, crash reports, Windows error reports) and the size of the Recycle Bin are read locally for the preview. Cleanup only removes items after an explicit action or an explicit automatic-cleanup setting (which only considers temporary files). The active power plan and the list of Windows startup programs (name and command) are read for display only and are not stored.
- **Local history:** local samples of CPU, RAM, main disk, compatible GPU use and ACPI/CPU/GPU temperatures every minute, for up to seven days.
- **Local learning:** averages and spread of CPU, RAM, disk, GPU and temperature for each of the 168 hours of the week; detected slowdown episodes (type, time, duration and peak; up to 120, for up to 30 days); and up to 60 recurring program names with their episode counts. It is a simple statistical calculation done on the computer. It can be exported or erased in **Settings → Privacy and data**.
- **Sensor service (Windows):** Windows only allows reading processor and motherboard temperatures with a driver. So, on first launch and with the person's permission (UAC), Nexo downloads the **PawnIO 2.2.0** installer from the official GitHub (a signed, open source driver, the same one LibreHardwareMonitor uses), checks its SHA-256 before running it, installs the driver if it is not there yet and creates the **“Nexo Device Care: sensores”** service (`NexoSensors`), with the collector copied to `%ProgramFiles%\Nexo Device Care\SensorService`. The service only reads sensors and answers readings through the local channel `\\.\pipe\NexoSensors`, which refuses network connections; it accepts no other commands. If the person declines the UAC prompt, Nexo keeps the readings that need no driver and asks again after a few days (or in Hardware). Uninstalling removes the service, the folder and PawnIO when Nexo installed it; if it already existed, it stays.
- **Detailed sensors:** current values and session minimums/maximums stay in memory for the sensors screen and are not automatically written to the seven-day history. If the person chooses **Export CSV**, Nexo creates a local file with the component name/category, sensor name and type, current value, unit, minimum, maximum and an advanced-sensor flag.
- **Local feedback:** recommendation category, helpful/not helpful answer and time, limited to the last 100 records.
- **Local activity:** title, details and time of the last 20 activities shown by the app.
- **Error log:** when something goes wrong in the app, Nexo records locally the time, the source (main process, screen, action, service), the message, the call stack and a short context (for example, the open screen), in the `logs` folder of the app data (up to 512 KB, with one previous copy). Each **error** and each **warning** carries the **trail** of the app's last steps before it: fixed names of screens and internal actions (with each one's result and duration) and power events such as sleep and resume; never what was typed nor the content of the actions. Before writing, it replaces your home folder and your user name with `<usuário>` and removes tokens, keys and emails that appear in the text. You can view, copy and erase everything in **Settings → Error log**. Errors and warnings go to the creator in the error reports (see Nexo server).
- **Observation sessions (only when you start one):** every second, total CPU use, the busiest core, memory, GPU, temperature and clock drop; every few seconds, the foreground program, the programs that used the most CPU and GPU (only the **name**, never the path or the command line) and Nexo's own cost; and, if you enable it, FPS and frame time of the chosen program. To tell whether something is a game, Nexo looks **only at the install folder** of the foreground program; the path is used at that moment and not stored. It never reads another program's memory. It keeps the 10 most recent sessions (report and a timeline reduced to one point every 5 s); you can export, delete each one or erase them all.
- **Usage profile:** the chosen option (Games, Work and creation or General use), only to adjust weights and the order of observations.
- **Change journal:** for each change made by Nexo (power plan, cleanups, drive optimization, system check) it records the operation name, the time, the risk, the previous and new value (for example, the power plan name and identifier), the count and size of removed items and how it was authorized. It keeps up to 100 records and lets you audit and revert.
- **Local benchmark:** the power plan experiment runs a synthetic CPU load for about 20 seconds, always started by you. Only the resulting numbers (medians, noise and verdict) are stored in the Journal.
- **Local preferences:** the chosen wallpaper (up to 12 MB, stored as a file in the app data folder), visual effects mode, automatic-cleanup setting and the time of the last run.
- **Nexo server:** the choices (sync, telemetry, error reports, include email), two random codes for this PC (one for telemetry, another for sync), the time of the last sends and, with sync on, the account email and the server session token, encrypted with the system vault when available, are stored in `cloud.json`. The installer checkbox is also stored in the Windows Registry at `HKCU\Software\NexoDeviceCare\Privacy\DeveloperTelemetryOptIn` (on Linux, in `privacy.json`). In the interface, the day's count of opened screens and used features is kept in `nexo-usage-day` and only leaves the PC with telemetry on.

The items above stay on the person's computer. The session chart keeps samples in memory for up to five minutes. Local activity names and details may include the result of actions started by the person, such as the number of removed files and the space freed.

## Optional features (off until you use them)

- **Game library:** to list what is installed, Nexo reads the Steam manifests (`libraryfolders.vdf`, `appmanifest_*.acf`) and Epic manifests (`*.item`), the `MicrosoftGame.config` file of games in `X:\XboxGames`, the GOG and Ubisoft Registry keys and the uninstall keys of game publishers' programs, and the install folders. Each game's path stays in the main process (it does not go to the interface or to files); the interface receives the name, store, size and last played time. Nexo **copies** the covers from each launcher's local cache into `covers` in the app data folder and stores in `games-manual.json` the games you add (name and executable path). Covers you choose are kept in the same folder.
- **Automatic sessions:** off by default. If you turn them on, a light PowerShell reads the foreground program every 3 s (PID, name and path). The path is only compared with the library folders, at that moment, and is not stored. The recorded session also keeps the library game identifier.
- **Tray and start with Windows:** off by default. The choices are stored in `nexo-settings.json`. Starting with Windows creates the `NexoDeviceCare` value in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`.
- **Unlock FPS measurement:** if you ask, Nexo adds your user (by SID) to the local “Performance Log Users” group (SID `S-1-5-32-559`), with Windows administrator permission (UAC). The user SID is only read in the main process. The change is recorded in the Journal and can be reverted; when uninstalling through the app, Nexo offers to undo it.
- **Options atlas:** reads, without changing anything, the configured memory speed and the speed reported by the modules, the number of modules, the current and maximum refresh rate reported by the graphics card, and the state of hardware-accelerated GPU scheduling, Game Mode, game capture and virtualization-based security (VBS). It does not store these readings.

## Game accounts and connections (optional)

- **Steam on this PC:** when you connect, Nexo reads only files that Steam itself keeps on the computer: `config/loginusers.vdf` (SteamID64 identifier and profile name of the accounts that have signed in on this PC), `config/avatarcache` (the profile picture) and `userdata/<account>/config/localconfig.vdf` (playtime and last played time of each game). It does not ask for a password and does not talk to Valve. What is stored: the chosen SteamID64 and profile name.
- **Sign in with Steam (optional):** the button opens Steam's **official** sign-in page (`steamcommunity.com/openid`) in the browser, through the Nexo server. You type the password only on Steam; Nexo never sees it. Steam returns only the account identifier (SteamID64) to the Nexo server; the server checks that answer with Steam itself and hands the app, only on this PC (address `127.0.0.1`), a signed pass with the SteamID64, valid for one year and stored encrypted in `connections.bin`. With that pass, the app asks the Nexo server for your public name and picture, the account's games (with playtime, last played time and the hours of the last 2 weeks) and a game's achievements; the server queries the Steam Web API with the **creator's key** (which never leaves the server) and **stores none of it**: each request goes to Steam and comes back. Valve receives from the server the SteamID64 being queried. Games and achievements only show up if your profile keeps “Game details” public. The server counts how many requests each SteamID64 made that day (usage limit), and the count disappears the next day. **Sign out of Steam** erases the pass and the picture from this PC.
- **Steam Web API key (optional):** if you paste **your own** key, Nexo queries `api.steampowered.com` to list the account's games (including uninstalled ones) with playtime. Valve receives the key, the SteamID64 and the normal connection data. The key is stored encrypted by Windows in `connections.bin` and can be erased at any time.
- **Xbox / Microsoft account (optional):** sign-in in your browser (PKCE, redirect to `localhost`), scope `XboxLive.signin`, no offline access. Nexo talks to `login.microsoftonline.com`, `user.auth.xboxlive.com`, `xsts.auth.xboxlive.com`, `profile.xboxlive.com` and `titlehub.xboxlive.com`, reads the gamertag, picture and game history (name, platforms, last played time and the official art address) and **discards the tokens**. What is stored, encrypted: gamertag, picture and that history.
- **Discord (optional):** Nexo talks to the Discord app open on the same PC through Discord's local channel (Rich Presence) and shows on your profile — to your friends — the game being recorded and/or “Cuidando do PC com o Nexo”, as you choose. Nothing goes through a Nexo server; Discord handles that status under its own rules.
- **Official covers (optional, off by default):** for games without a cover in the local cache, Nexo queries the Steam image CDN (by game number), the Steam store search (`store.steampowered.com`, by the game's **name**, accepting only an exact match) and the public Microsoft Store catalog (`displaycatalog.mp.microsoft.com`, by the game identifier). Those stores receive what was searched and the normal connection data. The images are downsized and stored in `covers`; games without a match are flagged for 7 days so the search is not repeated.
- **Full game details (with online content allowed):** when you open a game's page, the main process queries the Steam store (`store.steampowered.com/api/appdetails`: description, genres, release, score, screenshots, requirements) and the news (`api.steampowered.com/ISteamNews`) by game number; for games from other stores, it looks for the same exact name on Steam. With your Steam Web API key, it also queries your achievements (`ISteamUserStats`: schema, progress and global rarity); the profile needs public “Game details”. The page loads images (screenshots and achievement icons) straight from the Steam CDN, which receives the normal connection data. Answers are cached in `details` (store 7 days, news 3 hours, achievements 10 minutes).
- **Nexo's cost:** in Settings, the app shows its own CPU and memory use read from Electron; it is not stored.

## Extreme optimization (beta) — risk sessions

It is a **risky, beta** option that only runs after you tick the warning and type the confirmation phrase. During a risk session Nexo:

- creates a Windows **restore point** (with UAC). For that, it adjusts for a few seconds the `SystemRestorePointCreationFrequency` value (documented by Microsoft) and restores the previous value;
- **clones** the active power plan into “Nexo Lab (temporário)”, exports a backup copy of the original plan to the `lab` folder of the app data, writes a **lock** (`lab-lock.json`, with the identifiers of both plans) and, in the installed version, a **RunOnce** entry (`NexoLabRecovery`) to restore the original plan if the PC freezes;
- changes only processor settings of the temporary plan, runs synthetic CPU tests and reads the processor temperature, the power source and the **count** of serious errors (critical and error levels) from some providers in the Windows System log (hardware, power and video). It does not read the content of other events;
- at the end, goes back to the original plan and deletes the temporary plan, the lock and the RunOnce entry. In autonomous mode, a confirmed combination becomes a new plan “Nexo — Ajustado (date)”.

It stores in the app's internal browser storage (`nexo-lab-v1`): the evidence per setting (how many times it was tested, average gain, wins, losses, guards), the list of settings blocked by a guard and a summary of the last 15 risk sessions. In the Journal, each session is marked as a **risk session**, with the original values and what was tested.

## Google account (optional)

If you choose **Sign in with Google**, sign-in happens in your default browser, with OAuth 2.0 for installed apps (PKCE and a redirect to `127.0.0.1` on a temporary port). Nexo connects to `accounts.google.com` and `oauth2.googleapis.com` and, for the picture, to the `googleusercontent.com` address Google provides. It only asks for the `openid`, `email` and `profile` scopes, **without offline access**: after reading the profile, it revokes the access token and stores no tokens or passwords. Only these stay on this computer, encrypted with Windows data protection when available (`account/profile.bin`): the Google account identifier, name, email and sign-in time; the picture is stored in `account/avatar.*`. The email goes along with error reports so the creator can tell you when an error is fixed (you can untick it in Settings); the rest only leaves if you turn on sync (see below). Signing out erases these files and turns off sync on this PC.

## On Linux

Nexo works the same way locally, with the sources Linux provides: `/proc` (CPU, memory and program use), `/proc/mounts` and `statfs` (drives), `/sys/class/hwmon`, `/sys/class/thermal` and `cpufreq` (sensors), `nvidia-smi` when there is an NVIDIA card, `powerprofilesctl` (power profiles), `~/.config/autostart` and `/etc/xdg/autostart` (startup, read only) and `xprop` (foreground program, on X11 and XWayland). Data is kept in `~/.config/Nexo Device Care` and `~/.cache`. There is no setup wizard: the notices appear on the app's first launch.

- **Cleanup:** only the user's own files in `/tmp` and `/var/crash`, old thumbnails in `~/.cache/thumbnails` and the freedesktop Trash (`~/.local/share/Trash`).
- **FPS:** while the session records, Nexo reads the CSV log that **MangoHud** writes into a Nexo folder (`mangohud` in the app data) when the game is launched with the launch option shown in Sessions. The logs stay in that folder until you erase the data.
- **Library:** Steam (native, Flatpak or Snap; the same local files as on Windows) and the Heroic Games Launcher (`installed.json` and `library.json` for Epic and GOG).
- **Lab:** only switches the power-profiles-daemon profile; reads the kernel error count through `journalctl` (without storing the text).
- **Permissions:** nothing runs as root. TRIM (`fstrim`) and removing the `.deb` package ask for your password through pkexec.
- **Start with the system:** creates `~/.config/autostart/nexo-device-care.desktop`; uninstalling through the app deletes that file, the data, the caches and the AppImage (or removes the `.deb` package).
- **Discord:** talks through Discord's local socket in `$XDG_RUNTIME_DIR` (native, Flatpak or Snap).

## Optional component: PresentMon

To measure FPS, Nexo can run **PresentMon** (Intel, MIT license) as a separate program, only when you turn on the measurement. It reads Windows presentation events (ETW) from the chosen program and hands Nexo the frame times; nothing leaves the computer. It requires the user to be in the “Performance Log Users” group (or an administrator). Without a pinned hash in the build, the installer does **not** bundle the executable; you can point to a file you downloaded from the official site. Details in `THIRD-PARTY-NOTICES.md`.

## The Cortex (eternal memory)

The Cortex is Nexo's brain: it keeps a memory of how your PC behaves and investigates what makes the PC slow.

- **Where it lives:** the Cortex memory (measured minutes, events, machine snapshots and its hypotheses, proofs and conclusions) stays **only on this PC**, in the `cortex` folder of the app data, **forever**. It is not sent anywhere: not to the Nexo server, not to GitHub, not to any other service.
- **No erase button:** there is no button to erase this memory. **Erase learning and history** (“Apagar aprendizado e histórico”) erases only the old learning (see below) and does not touch the Cortex memory. Only uninstalling removes the folder.
- **Export:** in **Settings → Privacy and data** (**Export Cortex memory**) and on the Cortex page you can save a copy of the memory, as a `.db` (SQLite) file, wherever you choose. The live memory is never overwritten.
- **What it may do on its own:** by default the Cortex **only observes**. Automatic tests are **off** and only run if you turn them on in the Cortex page (or if you accept the optional integrated AI, which turns the tests on by default). Even when on, automatic tests are **low-risk only**, **only with the PC idle and no game in the foreground**, **always reverted** to the original value, and **at most 3 per day**. You can go back to “only observe” whenever you want.
- **Nothing leaves the PC:** neither the memory, nor the tests, nor what the Cortex concluded is sent.

## Export, erase and uninstall

- **Export:** in **Settings** you can save a JSON file with the history, the learning, the feedback, the activity, the journal, the sessions, the lab learning and the profile.
- **Erase the learning:** that button (“Apagar aprendizado e histórico”) erases the history, the learning, the feedback, the sessions and the lab learning. The change journal is kept so changes can still be reverted, and the Cortex memory is kept too (see **The Cortex**).
- **Uninstall:** uninstalling through Windows or through **Settings** removes the program, the data and preferences (including covers, account and lab), the caches, the shortcuts, Nexo's Registry entries (including `Run` and `RunOnce`) and the power plans created by the lab. Restore points remain managed by Windows. Sync copies on the server are not erased by uninstalling (use “Apagar meus dados do servidor”, Erase my server data, first). Updates keep the data.

## Network connections

At launch, the packaged version checks GitHub's public releases to see whether an update exists. Like any HTTP connection, GitHub may receive technical request metadata, including IP address, time, requested URL and client identification. Nexo attaches no computer inventory, process names, files, history, wallpaper or feedback to that check. No update is downloaded until the person chooses **Download and update**. Error reports go to the Nexo server while they are on (they start on; see below). Other connections only happen if you use the optional features above: opening a game through its launcher, official covers, signing in with Steam, the Steam Web API key, the Xbox account, Google sign-in and the Nexo server's sync and telemetry (each one only when on).

## Nexo server

Nexo has a server for account sync, error reports and telemetry. Telemetry is optional and off by default. So the app can keep getting better, I ask you to turn it on. It produces one summary per day, so it is harmless, and it takes nothing personal: only what helps us understand how the app behaves on other machines, so we can improve Nexo. Error reports start on, also with nothing personal, so problems get fixed, and they can be turned off in Settings.

The server runs on **Cloudflare** (Workers and the D1 database), at a `*.workers.dev` address, over HTTPS only. Cloudflare receives the normal data of any connection (IP address, time, app identification). The server does not store the IP address: to limit abuse, it keeps for one day only a digest of it mixed with a server secret, which cannot be turned back into the IP. Sync, telemetry and error reports are turned on and off separately, in **Settings**:

- **On first launch**, the app asks once (with the text above) whether you want to turn on telemetry. “Not now” leaves telemetry off. Whoever ticked **“Help improve Nexo”** in the installer has already answered: telemetry stays on and the app does not ask again.

### Telemetry (one summary per day)

- **When:** the app builds, on this PC, the summary of each day (in UTC). While the day is not over, it sends today's **partial** summary at most every 3 hours, so people who open Nexo for a single day are counted too. When the day ends (the next hour, or the next time Nexo opens), it sends the **complete** summary, which replaces the partial one on the server and is not sent again. Days when telemetry was off never leave, and a day older than 6 days is left out.
- **What is sent:**
  - **App:** version, system (Windows or Linux, system version, architecture), system language, how it was installed (installer, AppImage or .deb), how many days Nexo has been on this PC, which version it updated from, how many times it opened that day and for how many minutes it was open and in focus, and how long it took to open.
  - **Hardware:** processor maker and model, cores, total memory in GB, graphics card maker and model, monitors (resolution, scale and refresh rate), how many disks and their combined size, and whether the sensors work (without the values).
  - **How heavy Nexo itself is:** the app's average processor and memory use (with and without focus), peak memory, sky frames per second, interface freezes and the average graphics card use with Nexo in front (Full or Lite) and in the background.
  - **The PC's daily averages:** processor, memory, graphics card and disk (averages and peaks) and the highest temperature, taken from the local history of 1 reading per minute.
  - **What limited the PC:** how many loaded minutes the day had and, in each one, what was at its limit (the whole processor, a single core, the graphics card — and whether because of power, heat, full video memory or low clock —, RAM, a frame cap, or nothing), plus percentiles of use, clock and power of the graphics card and of the busiest core; from the sessions recorded that day, each one's conclusion and the average FPS and 1% low of one of them. Only classes and numbers, no program or game names.
  - **App settings:** visual effects, accent color, sky options, reading speed, usage profile, whether a custom wallpaper is used (not the image), automatic cleanup, tray, start with the system, automatic sessions, online covers and how many features are pinned.
  - **Usage:** how many times each **screen** was opened and the time in focus on it; which **features** were used (from a fixed list of names, such as “raio-x-do-pc”); which **feature card buttons** were used (by the card id in the code); and whether search, filters, quick search (Ctrl K), the news window and the meteor shower were used (only the count, **never the searched text**).
  - **App health:** which feature cards had no data or broke on this PC (code ids), which data sources failed and how long they took, how many times each internal app action ran, failed and took (by the action's fixed name), and how many times a Nexo process crashed, the window froze or an error happened, by source (only the count; the content of errors only goes through error reports, below).
  - **Library and lab:** how many games per store and how many installed (**without the names**), how many sessions were recorded and with FPS, and how many Journal changes were applied or reverted that day (by the action's fixed name).
- **What is never sent:** computer or user name, email, account, folders, file, program or game names, typed text, network address and individual sensor values.
- **With what:** a random code created on this PC. **No email, no account, no computer name**, even with sync on (telemetry never carries the session).
- **Retention:** 120 days. The creator's dashboard only shows sums and medians across PCs.

### Usage count (on by default)

So the creator knows **exactly** how many people installed and use Nexo (GitHub's download number is way off: it even adds automatic updates and people who download twice), the app and the installer tell the server that **this PC** exists. The **“Count this PC in Nexo's statistics”** switch is in **Settings > Privacy and data**, and the installer has the **“Count this install in Nexo's statistics (anonymous)”** box, already ticked.

- **What is sent:** a **scrambled PC code**, the app version and the system (Windows or Linux). The app sends it **once a day** (“this PC opened today”); the installer sends a notice when it **installs**, **updates** or **uninstalls**.
- **How the code is made:** Nexo reads the identifier the system itself gives the computer (on Windows, the `MachineGuid`; on Linux, the `machine-id`) and runs it through a one-way scramble (SHA-256 with a Nexo prefix). **The original identifier never leaves the PC.** The server scrambles the code again with a secret of its own (HMAC) before storing it, so not even the code that left the PC stays in the database, and it cannot be matched with any other app or site. Because it comes from the system, reinstalling Nexo counts as the **same PC**.
- **What is not sent:** computer or user name, email, account, folders, programs and network address. The PC code is **not** tied to telemetry, error reports or the account: each uses its own identification. The creator's dashboard and assistant see **summed numbers** (how many PCs opened, came back, updated) and, on the dashboard, a list of the latest PCs with only the day, version, system and how many days the app opened; **never the codes**.
- **Turning it off:** untick the switch in Settings (or the box in the installer). At the moment you turn it off, **a single “+1 turned off”** is sent, with no code at all, only so the creator knows how many people prefer not to be counted; after that, nothing else is sent. Turned off in the installer, uninstalling sends no notice either.
- **Retention:** days of use and installer notices disappear after 400 days, and the PC disappears after 400 days without being seen. Since the code is not tied to the account, “Erase my server data” has no way to find it; turning the count off stops the sends.
- **Known limit:** PCs cloned from the same Windows image (without sysprep) share the identifier and count as one. On Linux without `machine-id`, the app uses a random code kept in its data, and reinstalling counts as a new PC.

### Installs seen (to count new users)

When telemetry or an error report arrives, the server records the PC's **random code**, the dates it was first and last seen, the first and last app version, the system (Windows or Linux) and how it showed up (telemetry or errors). That is what shows the creator how many **new** PCs started using Nexo, without counting updates (the code lives in the app data). Nothing personal; it disappears after 400 days without being seen, and “Erase my server data” has no way to find that code, because it is not tied to the account.

### Error reports (on by default)

- **On by default, optional:** the **Error reports** switch is in **Settings > Privacy and data**. When off, nothing is sent. When turned back on, only errors that happen from then on are sent; nothing from the time they were off. (Between 0.11.1 and 0.11.2 they were mandatory; the choice of anyone who turned them off before that was kept.)
- **What is sent:** errors and warnings from the local log, grouped: the message, the call stack, the short context, the source, how many times and when it happened, the app version and the system. The app already removes your home folder and user name before writing, and the server cleans it again on arrival.
- **What else is sent:** each error's **trail** (the app's last steps before it, fixed names only; see Error log, above). Warnings (things that are not errors) are sent since version 0.11.4, and only those recorded after it first opens: older ones stay on the PC. See Error watchers, below.
- **Email (optional):** if you are signed in to Nexo with a Google account, the account email goes along so the creator can tell you when the error is fixed. The **“Include my email in reports”** option starts ticked and can be unticked in **Settings**: unticking also removes the email from the reports this PC already sent (the server deletes it right away; without a connection, the app tries again later). With sync on, the email comes from the server session (confirmed by Google); without it, the app provides the email of the account signed in to it and the server stores it marked as **unconfirmed**. It is never a typed field.
- **When:** 2 minutes after the app opens and every 30 minutes, if there is a new error.
- **Retention:** 180 days since the last occurrence. Erasing your server data removes your email from the reports you sent.

### Error watchers (sent with the error reports)

So the creator knows not only what breaks, but also what works **in a strange way**, the app has watchers that record a **warning** (at most once per launch for each kind) when:

- an **impossible reading** shows up (usage above 100 % or below 0, temperature below −10 °C or above 125 °C, total memory zero): only the field name and the rounded value are sent;
- the temperature **sensors** were working and stopped answering for 5 minutes with Nexo in focus;
- a **data source** of the cards fails 3 times in a row or takes more than 20 s: the fixed name of the source and the short failure message (already without your folder and user name) are sent;
- the PC's **first reading** takes more than 12 s, or the **sky** stays below 12 frames per second for 1 minute with Nexo in front;
- all of Nexo's processes together go over **1.5 GB of memory**, or the server **refuses this PC's usage count**;
- plus the warnings the app already recorded: frozen screen or window, slow action, app file that did not load, screen memory and the app's own warnings.

The watchers only send rounded numbers and fixed names (of the field, the source, the screen), plus the trail of the app's last steps. Never names of programs or games, folders, your user name or anything you typed. Only warnings that come from a watcher are sent; the others (like an action that did not work because you cancelled it) stay on the PC. The switch is the same as error reports: turned off, no error or warning is sent.

### Sync between PCs

- **The “password” is your Google sign-in:** when you turn it on, the browser confirms the sign-in and the server receives from Google only the account identifier, the email and the name. Nexo does not store the Google token; the server returns its own session (valid for up to one year), which is stored encrypted on the PC.
- **What is sent, from each PC:** the computer name and a copy of: preferences (visual effects, accent color, sky options, reading speed, tray, automatic sessions and online covers), usage profile, recorded game sessions (up to 10, whatever fits in 1 MB) and the activity history (up to 20). **Not sent:** the change Journal, the learning, the lab, the game library, game accounts, automatic cleanup (it deletes files, so each PC confirms its own), the wallpaper and any personal file.
- **Bringing data from another PC** is always your choice: you see the PCs in your account, pick one and tick what to bring. Preferences and profile replace this PC's; sessions and activities are merged with the ones here. Nothing comes in on its own.
- **Encryption, without overselling it:** each copy (and the PC name) is encrypted on the server with AES-256-GCM, with a key specific to your account, derived from a master key that only exists as a server secret; the database only stores the ciphertext, so a database leak does not reveal the content. **Because the “password” is the Google sign-in, and not a password of your own, the server can open the copies to hand them to you** — and, in theory, whoever operates the server could too. The creator's dashboard only shows **how many accounts** use sync in total; it **does not show** who they are, each one's PCs or the content, and no dashboard tool reads those copies.
- **Limits and retention:** up to 20 PCs per account. The copy of a PC that has not been updated for a year is deleted, and an account with no session and no copy disappears after 30 days.

### Creator's dashboard

Only the creator's email (configured as a server secret, outside the code) and the people the creator adds can enter the dashboard, through a single-use link that the app itself opens and an 8-hour cookie. Each person has a role: **collaborator** (sees errors, the emails of people who left their email in reports and aggregated telemetry; changes an error's state) or **read-only** (sees errors and telemetry, **without emails**). For the creator's coding assistant, there is a read key that only sees errors, **without emails**. Reports can be copied to a **private** GitHub repository of the creator, also without emails.

The creator uses an AI assistant (**Claude, by Anthropic**), connected to the dashboard through a connector with its own revocable authorization, to analyze telemetry and error reports and to mark errors as fixed. The assistant only receives aggregated numbers, anonymous data and errors **without emails**; it never receives emails, account data, the team or the keys. Everything it changes is logged in the dashboard.

### Turn off, erase and revoke

- **Turning off** telemetry, error reports, sync or the usage count in **Settings** stops the sends right away. The email in reports is removed when you untick “Include my email in reports”.
- **Turning off sync** ends this PC's session; the copies stay on the server until you erase them.
- **Erasing a PC's copy** or **“Erase my server data”** (all copies, the account and the email in reports) happens right away, from the app.
- **Uninstalling** does not erase the copies on the server: use “Erase my server data” first, if you want.

## Contact and code

- Project: <https://github.com/Samuklvm/Project-Nexo>
- Problems and suggestions: <https://github.com/Samuklvm/Project-Nexo/issues>
- Creator: <https://github.com/Samuklvm>
