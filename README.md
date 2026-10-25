# <img src="src/img/128.png" width="40" height="40" valign="middle"> Unifi Protect Viewer

A clean Electron app that auto-logs into your Unifi Protect instance and presents the camera liveview in a distraction-free fullscreen layout — no headers, no navigation, no clutter.

> Tested with Unifi Protect **v2.x – v6.x** running on UDM-Pro / UDM-SE / CloudKey Gen2+.

![Preview](screenshots/preview.png)

---

## Features

- 🔐 **Auto-login** — credentials are stored securely and used on every start
- 🖥️ **Fullscreen liveview** — all Unifi UI chrome is hidden automatically
- 📋 **Multiple profiles** — save any number of NVRs or dashboards and switch between them instantly
- ⚙️ **In-app configuration** — edit settings at any time without restarting (`F10` or tray menu)
- 🔗 **URL-only mode** — quickly switch liveviews without re-entering credentials
- 🔑 **Smart credential handling** — password is only overwritten when explicitly changed
- ⏳ **Loading overlay** — animated screen while cameras initialise, with 20 s auto-fallback
- 🔄 **Session auto-renewal** — re-logs in before the session token expires
- 🪟 **System tray** — minimize to tray, show/hide, switch profiles, open settings, quit
- 🔒 **Self-signed certificates** — accepted automatically
- 💾 **Portable mode** — config stored next to the executable (USB-stick friendly)
- 📐 **Persistent window geometry** — size and position remembered between sessions
- 🚀 **Startup arguments** — set monitor, fullscreen and profile via command-line for kiosk/shortcut setups

---

## Screenshots

### Liveview

![Liveview](screenshots/liveview.png)

### Profile selection

![Profile selection](screenshots/profile-selection.png)

### Configuration – Connection / Profiles

![Configuration – Connection / Profiles](screenshots/configuration-connection.png)

### Configuration – Startup

![Configuration – Startup](screenshots/configuration-startup.png)

### Loading overlay

![Loading overlay](screenshots/loading.png)

### Error page

![Error page](screenshots/wrong_configuration.png)

---

## Profiles

Unifi Protect Viewer supports saving **multiple profiles**. Each profile stores an independent set of:

| Field            | Description                                                                     |
| ---------------- | ------------------------------------------------------------------------------- |
| **Profile name** | A label shown in the sidebar and tray menu (e.g. "Front Entrance", "Warehouse") |
| **Liveview URL** | Full URL to your liveview (copy from the browser address bar)                   |
| **Username**     | Unifi Protect / UnifiOS login                                                   |
| **Password**     | Your password                                                                   |

Profiles can point to **different NVRs**, **different dashboards on the same NVR**, or anything else — there are no restrictions.

### Profile selection on startup

When **more than one profile** is saved and no startup profile has been set, the **profile selection screen** is shown on launch. Click any profile to start it immediately.

Check **"Always start with this profile"** to skip the selection screen in the future and go straight to that profile's liveview. You can clear this preference at any time in the configuration editor.

### Managing profiles

Open the configuration editor (`F10` or tray → **Edit Configuration**).

- **Add** a new profile with the **+** button in the sidebar
- **Switch** between profiles by clicking them in the sidebar
- **Delete** the active profile with the **Delete** button (at least one profile must remain)
- **Set a startup profile** by enabling the **"Always start with this profile"** checkbox (only shown when more than one profile exists)

![Configuration – profile editor with sidebar](screenshots/configuration-connection.png)

---

## Configuration

Start the application — the setup screen appears automatically on first launch.

| Field            | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| **Profile name** | Optional display label for this profile                       |
| **Liveview URL** | Full URL to your liveview (copy from the browser address bar) |
| **Username**     | Unifi Protect / UnifiOS login                                 |
| **Password**     | Your password                                                 |

### Edit Modes

| Mode          | What changes                                               |
| ------------- | ---------------------------------------------------------- |
| **URL only**  | Updates only the liveview URL – credentials stay unchanged |
| **Full edit** | Allows updating username and/or password                   |

The password field shows `unchanged` until you actually type something. The badge turns orange when a field has been modified.

### Example URLs

```
# Protect 3.x / 4.x / 5.x
https://192.168.1.1/protect/dashboard/635e65bd000c1c0387005a5f

# Protect 2.x
https://192.168.1.1/protect/liveview/635e65bd000c1c0387005a5f
```

---

## Keyboard Shortcuts

| Key   | Action                                                                   |
| ----- | ------------------------------------------------------------------------ |
| `F9`  | Restart the application                                                  |
| `F10` | Open profile selection (2+ profiles) or configuration editor (1 profile) |
| `F11` | Toggle fullscreen                                                        |

### F10 behaviour in detail

| Context                                        | Result                             |
| ---------------------------------------------- | ---------------------------------- |
| Liveview, 1 profile saved                      | Opens the configuration editor     |
| Liveview, 2+ profiles saved                    | Opens the profile selection screen |
| Configuration / profile selection / error page | Opens the configuration editor     |

---

## Command-line Arguments

Startup arguments let you control **monitor**, **fullscreen mode** and the **profile** to load — directly from a shortcut, script or task scheduler. They are **runtime-only overrides** and do not modify saved settings.

### Available arguments

| Argument           | Description                                                            |
| ------------------ | ---------------------------------------------------------------------- |
| `--monitor <n>`    | Launch on monitor **n** (1 = primary, 2 = second monitor, …)           |
| `--fullscreen`     | Start in fullscreen mode                                               |
| `--profile <name>` | Load the named profile on startup (case-insensitive, exact name match) |

**Behaviour:**

- CLI arguments take **priority over saved startup settings** (they do not overwrite them).
- If `--profile` is given but no profile with that name exists, the app falls back to the stored startup profile or the profile-selection screen as usual.
- If `--monitor` exceeds the number of connected displays, it is clamped to the last available display.
- `--fullscreen` and `--monitor` can be used independently — you can move to a different monitor without enabling fullscreen.

### Examples

**Windows – portable executable (PowerShell / Command Prompt):**

```powershell
# Start fullscreen on the second monitor with the "Warehouse" profile
.\unifi-protect-viewer.exe --monitor 2 --fullscreen --profile "Warehouse"

# Start on monitor 2 without fullscreen
.\unifi-protect-viewer.exe --monitor 2 --profile "Front Door"

# Start fullscreen on the primary monitor
.\unifi-protect-viewer.exe --fullscreen

# Start a specific profile without any display override
.\unifi-protect-viewer.exe --profile "Office NVR"
```

**Development (`npm start`):**

```bash
# npm run start will not forward extra args directly, use node/electron instead:
npx electron . --monitor 2 --fullscreen --profile "Warehouse"
```

**Windows Shortcut:**  
Right-click your desktop shortcut → _Properties_ → append the arguments to the **Target** field:

```
"C:\...\unifi-protect-viewer.exe" --monitor 2 --fullscreen --profile "Warehouse"
```

**Windows Task Scheduler:**  
Set the **Program/script** to the `.exe` path and put the arguments in the **Add arguments** field:

```
--monitor 2 --fullscreen --profile "Warehouse"
```

> 💡 **Tip:** Create one shortcut per camera location and pin them to your taskbar — each shortcut can target a different monitor, profile and fullscreen setting.

---

## Tray Menu

Right-click the system-tray icon for:

**Show / Hide** · **Edit Configuration** · **Switch Profile** _(list of all saved profiles with the active one checked)_ · **Restart** · **Reset & Restart** · **Quit**

Clicking a profile in the **Switch Profile** submenu loads it immediately without restarting.

![Tray menu with profile switcher](screenshots/tray-menu.png)

---

## Installation

Download a pre-built release from the Releases page, or build it yourself (see below).

### macOS

The release builds are ad-hoc signed. On first launch, Gatekeeper may warn that the developer cannot be verified ("unidentified developer") — expected for browser downloads, which carry a quarantine attribute:

- Right-click the app → **Open** → **Open**, or
- Remove the quarantine attribute:

  ```bash
  xattr -dr com.apple.quarantine /path/to/unifi-protect-viewer.app
  ```

> **Note:** macOS archives come from the GitHub release only. Code signing runs through `codesign`, which requires a macOS host, and the Gitea pipeline executes entirely on Linux — it does not build darwin targets at all.

## Troubleshooting

### Camera tiles show "Your browser doesn't support Enhanced encoding"

UniFi Protect's **Enhanced encoding** means H.265/HEVC. Decoding happens in the rendering
engine, not in this app — the Viewer is an Electron (Chromium) container and contains no
codec logic of its own. Chromium ships **no HEVC software decoder**; HEVC only works
through a platform decoder supplied by the operating system:

| Platform | HEVC decode path   | Practical behaviour                                                           |
| -------- | ------------------ | ----------------------------------------------------------------------------- |
| Windows  | Media Foundation   | Works on Windows 8+ (HEVC Video Extensions on 10/11)                          |
| macOS    | VideoToolbox       | Works on macOS 11+ (hardware; software fallback on Apple Silicon)             |
| Linux    | VA-API / V4L2 only | **No software fallback** — only works when the GPU driver exposes HEVC decode |

On Linux the result depends on the graphics stack, not on the Viewer version:

- Mesa's VA-API is commonly built **without** H.264/H.265 codecs for patent reasons
  (`-Dvideo-codecs`). Check what your driver actually reports:

  ```bash
  vainfo | grep -i hevc      # package: libva-utils
  ```

- Intel: the full-feature driver (`intel-media-va-driver-non-free`) is required — the
  free-kernel build (`intel-media-va-driver`) is limited.
- NVIDIA: VA-API is not supported by Chromium by default (NVDEC is not wired up), so HEVC
  does not work on NVIDIA GPUs on Linux.
- Chromium's Linux VA-API path is feature-flag gated (`AcceleratedVideoDecodeLinuxGL`) and
  officially best-effort. Even a capable driver may fall back to software decode, which then
  has no HEVC decoder at all.

**Practical options for Linux kiosk setups**

1. Set the affected cameras to **Standard (H.264)** — Protect → Camera settings → Recording → Encoding.
2. Or run the kiosk in **Firefox (≥ 137)**, which can decode HEVC on Linux through the system FFmpeg.
3. Only if `vainfo` lists HEVC decode entry points is it worth trying Electron with the VA-API flags.

Codec capability is logged on every start, so this can be answered from the log alone:

```text
2026-10-23T13:21:03.112Z [upv app] runtime: electron 42.11.18 / chromium 148.0.7778.280 on linux
2026-10-23T13:21:05.902Z [upv window] [upv] codec probe: {"hvc1.1.6.L93.B0":{"canPlayType":"no","mse":false},"hev1.1.6.L93.B0":{"canPlayType":"no","mse":false},"mcap":{"supported":false,"powerEfficient":false}} platform:linux
2026-10-23T13:21:05.902Z [upv window] [upv] HEVC not decodable here – Enhanced encoding cameras will fail
```

> **Note on capability checks:** incomplete codec IDs (`"hvc1"`, `"hev1"`) are always rejected
> by Chromium, so a bare ID test reports "unsupported" even on machines that can decode. Only
> the full profile/level/tier ID gives a real answer.

---

## Building

### Prerequisites

```bash
npm install
```

### Local builds

```bash
# Current platform / arch (reads env vars or falls back to host)
npm run build

# Explicit targets
npm run build:win:x64
npm run build:win:ia32
npm run build:mac:x64
npm run build:mac:arm64
npm run build:linux:x64
npm run build:linux:arm64

# Portable variants (append :portable to any target above)
npm run build:win:x64:portable
npm run build:linux:arm64:portable
```

All output lands in `builds/` and is automatically renamed to include the version:

```
builds/unifi-protect-viewer-win32-x64-1.0.0/
builds/unifi-protect-viewer-win32-x64-1.0.0-portable/
builds/unifi-protect-viewer-linux-arm64-1.0.0-portable/
```

### Build environment variables

All build options are controlled via environment variables — no source files need to be changed.

| Variable                | Default       | Description                                                                      |
| ----------------------- | ------------- | -------------------------------------------------------------------------------- |
| `UPV_PLATFORM`          | host platform | `win32` · `darwin` · `linux`                                                     |
| `UPV_ARCH`              | host arch     | `x64` · `ia32` · `arm64`                                                         |
| `UPV_PORTABLE`          | `false`       | `true` → portable build                                                          |
| `UPV_OUT_DIR`           | `builds`      | output directory                                                                 |
| `UPV_ENCRYPTION_KEY`    | `****`        | encryption key for portable config store                                         |
| `UPV_MAC_SIGN_IDENTITY` | `-`           | macOS signing identity (`-` = ad-hoc; set a Developer ID value for real signing) |

**PowerShell example:**

```powershell
$env:UPV_PLATFORM="linux"; $env:UPV_ARCH="arm64"; $env:UPV_PORTABLE="true"
node scripts/build.js
```

---

## Portable Mode

When `UPV_PORTABLE=true`, the config is stored in a `store/` directory next to the executable instead of the OS user-data folder. All profiles are included. Ideal for USB sticks or kiosk setups.

> ⚠️ Set a strong `UPV_ENCRYPTION_KEY` before distributing portable builds.

Window size/position is **not** persisted in portable mode.

---

## Project Structure

```
src/
├── main.js                  # Electron entry point
├── main/
│   ├── app.js               # App bootstrap & lifecycle
│   ├── cli.js               # CLI startup argument parser (--monitor, --fullscreen, --profile)
│   ├── ipc.js               # IPC handler registration
│   ├── store.js             # Persistent config storage – profiles, startup pref, window bounds
│   ├── tray.js              # System-tray icon & context menu (incl. profile switcher)
│   └── window.js            # Main window factory & load-failure handler
├── html/
│   ├── config.html          # Configuration / profile editor
│   ├── profile-select.html  # Profile selection screen (shown on startup with 2+ profiles)
│   ├── index.html           # Error / connection-failure page
│   └── shared.css           # Shared design system (dark theme variables, components)
├── js/
│   ├── preload.js           # Electron preload – IPC bridge + all liveview automation
│   └── liveview/            # Reference copies (not loaded at runtime)
│       ├── utils.js         # Shared DOM utilities
│       ├── overlay.js       # Loading overlay
│       ├── login.js         # Auto-login handler
│       ├── v2.js            # Liveview handler – Protect 2.x
│       ├── v3.js            # Liveview handler – Protect 3.x
│       └── v4.js            # Liveview handler – Protect 4.x / 5.x / 6.x / 7.x
└── img/
    └── 128.png / 128.ico / 128.icns / 512.png

scripts/
└── build.js                 # Universal build script (env-var driven)
```

> **Note on `src/js/liveview/`:** The Electron preload sandbox (`contextIsolation=true`) does not
> allow loading local files via `require()`. All liveview logic is inlined directly into
> `preload.js`. The files in `liveview/` are readable reference copies — edit them there and sync
> changes into the matching section of `preload.js`.

### Data model

Each profile is stored as a JSON object in the encrypted config store:

```jsonc
{
  "profiles": [
    {
      "id": "uuid-v4",
      "name": "Living Room NVR",
      "url": "https://192.168.1.1/protect/dashboard/635e…",
      "username": "admin",
      "password": "<encrypted>",
    },
  ],
  "activeProfileId": "uuid-v4", // currently loaded profile
  "startupProfileId": "uuid-v4", // auto-selected on launch (null = show selector)
}
```

Existing single-profile installations are **migrated automatically** on first launch — no data is lost.

---

## Development

```bash
npm start
```

Hot-reload via `electron-reloader`. Open DevTools via right-click inside the window.  
All automation steps emit `[upv]`-prefixed log messages so you can follow every step in the console.

---

## License

[MIT](LICENSE) © 2026 Sebastian Loer — use it however you like, commercially or otherwise. Attribution appreciated.

---

## History

Originally inspired by the [Unifi Protect Chrome App](https://github.com/digital195/unifi-protect-viewer/tree/caaec3523361f5494338b333426cc1af5a48707a) by remcotjeerdsma / digital195, which first had the idea of stripping the Unifi Protect UI chrome to show a clean camera liveview.
