# Compose health checks

- `depends_on: { db: { condition: service_healthy } }` waits for the health check, not just the start.
- `docker compose up --wait` returns only when every service with a health check is healthy; handy in
  scripts and CI.
- Distroless images have no shell: probe with the language runtime they ship (`python -c "urllib…"`)
  or leave the health check out.
- `start_period` is a grace period: failures during it don't count against `retries`.
- Bind mounts store the absolute host path in the container. After moving the project folder, recreate the
  containers (`docker compose up -d --force-recreate`), otherwise they fail with "not a directory".
