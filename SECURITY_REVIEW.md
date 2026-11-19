# Friends demo security review — 2026-11-15

Scope: the password-protected, single-instance Render Free demo in `render.yaml`. This is a source and local integration review; no Render deployment or container image was available to inspect.

## Trust boundaries

- Visitors reach the Node server through Render HTTPS and its Cloudflare edge. The demo password protects all content and APIs except the health check. Capture IDs are scoped to a separate HttpOnly visitor cookie.
- Browser requests can trigger expensive Overture, OpenStreetMap, Nominatim, and terrain reads. Results and terrain are temporary server memory. Free mode disables account endpoints and limits capture area.
- The Python reader fetches a release catalog, then reads remote Parquet assets. The catalog and map services are external data sources, not application code.

## Findings fixed for the demo

1. **Quota bypass:** a paused capture could resume while another capture ran because resume used the three-job limit. Free mode now permits only one active capture across both paths. Integration test covers this.
2. **Expensive narrow geometry:** a thin polygon could satisfy the area limit while spanning a much larger remote query. Free mode now requires each bounding-box side to be at most 2 km as well as area at most 0.25 km². Integration test covers this.
   Free capture also stops at 20,000 mapped features to reduce memory pressure on a small instance.
3. **Unlimited demo password attempts:** invalid Basic credentials now receive a 20-attempt, 15-minute per-IP limit. Render's edge overwrites `CF-Connecting-IP`; only the configured Render path trusts that header. Integration test covers the limit.
4. **Weak CSRF fallback:** a mutation without trustworthy `Origin`, `Referer`, or `Sec-Fetch-Site: same-origin` was accepted. Mutations now require same-origin evidence and reject `same-site`, `cross-site`, and `none` fetch contexts. Integration tests cover both blocked and allowed requests.
5. **Browser script policy:** an enforced Content Security Policy now limits script sources, hashes the two inline startup blocks, and blocks objects, frames, and foreign form targets. Leaflet 1.9.4 CSS/JS use the checksums published by Leaflet. The response also sends a restrictive Permissions Policy.
6. **Remote asset address trust:** the Python reader now accepts Parquet URLs only under Overture's documented Azure or S3 release prefixes. It also validates release format. A local Python check accepts expected addresses and rejects a loopback URL.
7. **Known vulnerable Python dependency:** local `aiohttp` is 3.13.5, which falls within published 2026 advisories. Hosted installs now require `aiohttp>=3.14.4,<4`, the first release that fixes the cited issues.

## Remaining limits and release gates

- **No live deployment verification yet.** The Render service, HTTPS behavior, environment values, cookie attributes in a real browser, and image build still need an end-to-end check after the repository is connected. Docker is unavailable in this workspace.
- **Laptop reader remains on Python 3.9 and aiohttp 3.13.5.** The patched aiohttp line requires Python 3.10 or newer. Upgrade the Mac Python and recreate `.venv` before using the laptop tunnel for a wider audience. The Render Docker image installs Debian Bookworm Python 3.11.
- **The free instance has 512 MB memory and temporary storage.** It can still restart under large Overture results or traffic; its IP limits and jobs are process-local and reset on restart. Keep the demo password with a small trusted group and monitor Render logs/usage.
- **Three.js modules still load from a pinned CDN URL.** CSP limits this to the configured CDN, but it does not provide an integrity hash for the module graph. Self-host those assets before a public launch.
- **Accounts and billing are not ready for public signups.** Free mode disables account APIs. The full mode still needs verified email, recovery, durable study ownership, entitlements, privacy/terms, and deployment-wide rate limiting before public use.
- **Dependency review is not a full image scan.** There are no npm runtime dependencies. Python packages are installed within version ranges; scan the built image and resolved package versions after deployment.

## Verification run

- `npm test`: 33 passed.
- `npm run test:demo`: 2 passed (HTTP integration, including the new security cases).
- `node --check server.mjs` and `node --check demo-server.integration.mjs`: passed.
- Python reader syntax and asset-address checks: passed with the existing local environment.
- Browser smoke check on a temporary free-mode server: homepage rendered, workspace opened, Leaflet map initialized with 24 tiles, and no browser error logs were reported under the new CSP.
- Tracked-file secret pattern scan and `git diff --check`: no findings.
