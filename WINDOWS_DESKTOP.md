# Windows desktop build

The Windows app runs the existing web interface and Node server on `127.0.0.1` with a random port. It bundles the Python Overture reader. Map tiles, place search, terrain, and site capture still require internet access.

## Build an installer

The `.github/workflows/windows-desktop.yml` workflow runs on a Windows runner. From a GitHub repository containing this code and its lockfile, select **Actions → Windows desktop installer → Run workflow**. Download the installer from the completed run's `site-context-studio-windows-installer` artifact. The artifact expires after 30 days. GitHub Actions artifacts generally require repository access, so distribute the verified installer through a private release or file host when a direct friend-accessible link is needed.

To build on a Windows PC with Node 24 and Python 3.12:

```powershell
npm ci
python -m pip install -r requirements-online.txt pyinstaller==6.22.3
python -m PyInstaller --noconfirm --clean --onedir --name site-context-reader --collect-all pyarrow --collect-all shapely --collect-all fsspec --collect-all aiohttp fetch-overture.py
npm test
npm run dist:win
```

The installer is written to `release/`. It is unsigned until a Windows code-signing certificate is configured; Windows may warn before installation. Do not describe this as a verified release until the installer has been built and tested on Windows.

## Data and release limits

- Account data is stored under Electron's per-user application data directory. An account created in the desktop app is local to that installation; it is not a cloud account or a paid entitlement.
- Capture jobs currently live in memory and disappear when the app closes. Export the package before quitting. Durable studies are a separate release step.
- The desktop window keeps Node integration disabled, enables renderer sandboxing and context isolation, denies webviews and permissions, and sends HTTPS external links to the system browser. The local server rejects requests with an unexpected Host header.
- The first installer targets Windows x64. Build and smoke-test on Windows 10/11 before sharing it.
- The current npm audit reports six moderate advisories through Electron Builder's build-only `minimatch` dependency chain, with no high or critical findings. The affected tool handles trusted files during packaging and is not shipped as an app runtime dependency. Recheck the advisory and upstream fix before release (next review: 2026-12-16); do not force a major dependency downgrade just to silence the audit.
