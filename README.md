# DUD3 Rush PRO

Web apps for the DUD3 delivery yard, hosted on GitHub Pages:

| App | URL | Used by |
|---|---|---|
| **Rush PRO** (yard dispatch) | https://amazonrushdud3-web.github.io/dud3-rush/ | Yard marshals: attendance, waiting batches, breaks, violators, Received-In scanning |
| **Driver Hub** | https://amazonrushdud3-web.github.io/dud3-rush/driver.html | Drivers: live batch / queue status, QR code, alerts |

Both are installable apps (PWAs) and talk to one Google Apps Script backend that reads and writes the dispatch Google Sheet.

## Files

| File | What it is |
|---|---|
| `index.html` | Rush PRO |
| `driver.html` | Driver Hub |
| `assets/core.js` | Shared code: backend URL, storage, network calls, install prompt |
| `assets/base.css` | Shared colours, splash screen, install sheet |
| `driver-sw.js` | Driver Hub notification service worker (no caching) |
| `manifest.webmanifest`, `rushpro.webmanifest` | App install manifests |
| `*-icon-*.png` | App icons |

## Changing things

- **Backend URL:** `assets/core.js` → `CONFIG.API_URL`.
- After changing `assets/core.js` or `assets/base.css`, bump the `?v=` number where `index.html` and `driver.html` load them, so phones fetch the new copy.
- The repo must stay **public**. GitHub Pages on a free account only works for public repos.
- The Apps Script backend code is **not** kept in this repo.
