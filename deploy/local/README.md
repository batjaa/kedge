# Run Kedge on any machine

One command on any box with **git + docker**:

```bash
git clone https://github.com/batjaa/kedge.git && cd kedge && ./deploy/local/up.sh
```

First run generates `deploy/local/.env` (random app key, DB password, internal
secrets — gitignored), builds the images from source, starts everything
(proxy + api + queue worker + scheduler + web + postgres + kroki), waits for
health, and prints the URL — `http://localhost:8080` by default
(`KEDGE_PORT=9090 ./deploy/local/up.sh` on first run to change).

`SELF_HOSTED=true` is fixed here: no demo mode, sign-in is the front door.
Diagrams render via the bundled Kroki — nothing leaves the machine.

## Day-2

| Task | Command |
|---|---|
| Stop | `docker compose --env-file deploy/local/.env -f deploy/local/compose.yml down` |
| Reset (drop data) | `… down -v` |
| Upgrade | `git pull && ./deploy/local/up.sh` (migrations run on boot) |
| Logs | `docker compose --env-file deploy/local/.env -f deploy/local/compose.yml logs -f api web` |

## LAN access

Cookies bind to the origin, so to use Kedge from other devices set
`APP_URL=http://<this-machine-ip>:8080` in `deploy/local/.env` and re-run
`up.sh`. GitHub sign-in stays hidden until you register an OAuth app and fill
`GITHUB_CLIENT_ID`/`SECRET` (callback: `<APP_URL>/auth/github/callback`).

## Relationship to the real M7 deliverable

This is the early slice of SPEC §20.2 (same single-origin topology, bundled
Kroki, migrate-on-boot). M7 proper adds: tagged prebuilt images (no local
build), FrankenPHP instead of `artisan serve`, TrustProxies/TLS guidance,
telemetry opt-out, and backup/upgrade documentation.
