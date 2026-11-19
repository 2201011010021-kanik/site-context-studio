# Friends-only demo

The demo runs on this Mac as a separate Node 24 process on loopback port `18787`. A Cloudflare Quick Tunnel supplies HTTPS. The demo has its own account database in `.local/demo-accounts.sqlite` and a separate access password in `.local/demo-password.txt`. Both are excluded from source control. The local development site at `localhost:8787` uses a different database.

To find the **current** link after a restart:

```sh
grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' .local/demo-tunnel-error.log | tail -1
```

Share that link and the access password only with invited testers. The browser will ask for a username and password: use `demo` as the username and the contents of `.local/demo-password.txt` as the password. User accounts inside the app are separate from this first access check.

The Mac must stay awake, connected to the internet, and signed in. Quick Tunnel addresses are temporary and can change whenever the tunnel restarts. The launch agents restart the server and tunnel at login, but the old link will not follow a new tunnel address. [Cloudflare describes Quick Tunnels as testing tools without a permanent address](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

The demo account database is backed up locally at login and daily at 03:00 in `.local/backups/`. These backups are on the same Mac; they are not off-device disaster recovery. Capture jobs and exports are session-only and disappear after two hours or a server restart. Paid plans remain previews and cannot be purchased.

To stop sharing, run `./scripts/stop-demo-share.sh`. To start it again, run `./scripts/install-demo-share.sh`; then get the new URL from the tunnel log. To change the access password, replace `.local/demo-password.txt` with a new secret, keep file permissions at `600`, and restart the demo server launch agent.
