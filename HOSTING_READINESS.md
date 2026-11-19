# Hosting readiness — 9 November 2026

**Verdict:** The local site runs and its automated checks pass. It can be prepared as a small, clearly labelled free beta on a single persistent server. It is **not ready for public accounts, multiuser studies, or paid checkout**. Pricing currently describes proposed plans; no payment flow or paid entitlement exists.

**Friends-only demo update, 14 November 2026:** A separate Node 24 demo instance now runs on this Mac behind a password-protected Cloudflare Quick Tunnel. Its account database is separate and backed up locally each day. Capture access is scoped to a visitor cookie, and login, capture, search, and export requests have per-visitor limits. A real Overture buildings capture and ZIP export passed through the HTTPS link. See [DEMO_SHARING.md](DEMO_SHARING.md) for its temporary-link and session-data limits. This does not change the public-launch verdict below.

## Already verified

- `npm test`: 33 passing tests.
- An isolated Node process served `/` and `/api/health` with HTTP 200. The Python Overture reader dependencies import successfully.
- The server now accepts `HOST` as well as `PORT`; `HOST=0.0.0.0` can bind within a container, while the local default remains loopback.
- The main and urban maps now request the exact OpenStreetMap raster-tile URL required by its [tile usage policy](https://operations.osmfoundation.org/policies/tiles/).

## Before a public free beta

1. **Choose a persistent Node host.** Package Node 24 and the Python dependencies from `requirements-online.txt` in a repeatable container build. Run one application instance initially: capture jobs, search throttling, and authentication limits currently live in process memory. The Mac `launchd` script is for local development.
2. **Add a domain and HTTPS reverse proxy.** Set `HOST=0.0.0.0`, `PORT`, `ACCOUNTS_DB` on a durable volume, and `SECURE_COOKIES=1`. Add HSTS and a Content Security Policy after checking the app's third-party scripts, map tiles, and image sources. Serve the existing Leaflet and Three.js dependencies locally or add integrity protection and a deliberate CSP.
3. **Protect public API capacity.** The three-job limit is global, so a few anonymous clients could occupy it. Add per-user/IP capture quotas and request limits, bound memory and export sizes, and monitor failed upstream calls. The authentication limiter is an in-memory counter keyed to the socket IP; behind a reverse proxy it may treat all visitors as one IP. Replace it with a proxy-aware, shared limiter before opening accounts.
4. **Confirm map-service capacity and attribution.** The current place search queues requests to public Nominatim at 1.1-second intervals in one process. Its [policy](https://operations.osmfoundation.org/policies/nominatim/) sets a maximum of one request per second for the entire application, requires identification and attribution, and allows moderate user-triggered search; a larger audience needs another provider or a properly shared queue. Keep map attribution visible and do not rely on community tile servers for a paid service with uptime expectations. Overture has [theme and upstream attribution requirements](https://docs.overturemaps.org/attribution/).
5. **Decide imagery for launch.** The no-key satellite fallback is an old EOxCloudless layer with no uptime promise; confirm its exact layer rights and attribution before commercial use. If using MapTiler, restrict the browser key to the production domain as its [key guide](https://docs.maptiler.com/guides/developer/credentials/api-key/) requires.
6. **Add operations basics.** Configure deploy and rollback steps, a health check, structured error logs, uptime alerts, backup and restore for the account database, and a real capture/export smoke test on the public HTTPS domain. Pin and test Python dependency versions in the deployed image.

## Before opening public accounts or paid plans

- Verify email ownership and provide account recovery. Publish privacy and terms pages for the email and profile data collected. Test account deletion and backup retention.
- Tie every capture, terrain request, analysis, and export to its owner. Today jobs are addressed only by an unguessable ID and are not attached to an account; restarting the process erases them.
- Store studies durably, with ownership and retention rules. A local SQLite volume can support one instance if it is backed up; a multi-instance service needs a shared database and shared job state.
- Implement server-side plan entitlements, usage accounting, checkout, billing webhooks, receipts, and cancellation before enabling Pro or Studio purchase. Do not describe proposed features as available until they work.

## Host and domain decisions still needed

Choose the hosting provider, production domain, whether the first release is a small free beta or an account-based launch, and the map/imagery provider budget. Those choices determine the final deployment configuration and cost.
