# Free laptop-independent friends demo

The full app can run on **one Oracle Cloud Always Free Ampere A1 VM** with Docker Compose. This keeps the Node 24 server, Python Overture reader, SQLite accounts, and capture workers together. Caddy provides HTTPS. The VM runs while the laptop is off. Oracle currently includes up to 2 Arm OCPUs, 12 GB RAM, and 200 GB combined block storage in Always Free; confirm the shape is marked Always Free before creating it. Capacity can be unavailable, and Oracle may reclaim idle free instances.

## What needs an account

Create an Oracle Cloud Free Tier account, choose the home region where the VM will live, and create an **Always Free** `VM.Standard.A1.Flex` Ubuntu instance with 2 OCPUs and 12 GB RAM (or another free allocation with at least 2 GB RAM). Oracle usually requires a phone number and a card for account verification even for free resources. Do not select paid resources. The app source must be copied to that VM; no OCI account or source remote is connected to this folder yet.

## Deploy on the VM

1. Open inbound TCP ports **22** (restrict to your IP), **80**, and **443** in the Oracle network security list and OS firewall. Point a domain or free DNS name to the VM public IP. A hostname such as `site.<public-ip>.sslip.io` resolves without an account, but changes if the public IP changes; a free DuckDNS name can remain stable if you update its record.
2. Install Docker Engine with the Compose plugin on Ubuntu. Copy this `site-studio` folder to the VM, excluding `.local`, `.venv`, `local-data`, and `.env` (these include private or large local files). Keep the VM source directory private.
3. In the copied folder, create `.env` from `.env.example`. Set `SITE_DOMAIN` to the DNS hostname and `DEMO_PASSWORD` to a fresh strong secret. Keep `.env` private with `chmod 600 .env`. Create `data` with `mkdir -p data`.
4. Run `docker compose up -d --build`. The first build installs the Python reader. Caddy obtains and renews HTTPS certificates when DNS and ports 80/443 work. Check `docker compose ps` and `docker compose logs --tail=100`.
5. Open `https://<SITE_DOMAIN>/api/health` and expect `200`. Open the home page and enter the demo password (username `demo`). Complete a small boundary capture and ZIP download before sharing the HTTPS link.

The cloud account database starts empty. Existing Mac demo accounts are not copied automatically. The bind mount at `./data` keeps the new account database across container restarts and updates. Configure an Oracle block volume backup or an off-VM SQLite backup before relying on those accounts. Capture jobs and exports still live in memory and end when the app restarts. Pro and Studio remain previews; no checkout exists.

## Free-host limitations

Always Free capacity may be unavailable in the chosen region. Oracle can reclaim low-activity free VMs; this is a friends demo, not a guaranteed-uptime service. The app sends map and Overture requests to external providers with their own limits. The VM, public IP, DNS, firewall, and backups still need an owner to maintain them.
