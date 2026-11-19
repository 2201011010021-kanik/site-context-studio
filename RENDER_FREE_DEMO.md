# Free hosted preview

`render.yaml` sets up a free Docker web service. It uses the same Node 24 server and Python reader as the laptop demo, so the site can be opened when the laptop is off. This free preview has a stable `onrender.com` address once deployed.

## Limits shown to visitors

- The service sleeps after 15 minutes with no requests. The first visit after sleep may take about a minute to load.
- The free container has 512 MB RAM and limited CPU. Captures are restricted to **0.25 km²**, a **2 km maximum on either bounding-box side**, **20,000 mapped features**, and one active job at a time. A real capture still needs to be tested on the hosted service; memory and upstream network limits may require a smaller boundary.
- Accounts are disabled on this preview because Render's free filesystem is erased on sleep, restart, or deploy. Visitors can use the tool behind the shared demo password and download their work. Studies and jobs remain session-only.
- Free service hours and outbound data are limited. Render may suspend a free service that sends unusually high outbound traffic. This is a small friends demo, not dependable production hosting.

## Publish

1. Put this `site-studio` folder in a private GitHub repository. `.gitignore` excludes local accounts, passwords, data extracts, and virtual environments. Keep the repository private because it contains unreleased source.
2. In Render, create a Blueprint from that repository's `render.yaml`. The plan is explicitly `free` and has no persistent disk or paid database.
3. Enter a new strong `DEMO_PASSWORD` when Render asks for it. Share it separately with invited friends. The server refuses to start if it is missing.
4. After deployment, check `/api/health`, open the home page with username `demo` and the password, and complete a small capture and ZIP export. Share the `onrender.com` URL only after that test succeeds.

The existing Mac accounts are not copied to this preview. To keep accounts and a larger capture limit while staying within an eligible free allocation, see [CLOUD_DEMO.md](CLOUD_DEMO.md) for the Oracle VM option; that requires a separate Oracle account and VM setup.
