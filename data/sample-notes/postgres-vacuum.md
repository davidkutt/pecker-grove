---
domains: [db]
topics: [db/performance]
---

# Postgres: VACUUM and bloat

- Autovacuum runs per table once dead tuples exceed `autovacuum_vacuum_threshold` plus
  `autovacuum_vacuum_scale_factor` × rows (defaults 50 and 0.2). On large, busy tables 20 % is far too late:
  set the scale factor per table, e.g. `ALTER TABLE events SET (autovacuum_vacuum_scale_factor = 0.02)`.
- `VACUUM` frees space for reuse inside the table; only `VACUUM FULL` (or `pg_repack`) gives it back to the
  operating system, and `VACUUM FULL` holds an exclusive lock for the whole run.
- Check dead tuples: `select relname, n_dead_tup, last_autovacuum from pg_stat_user_tables order by 2 desc;`
- A long-running transaction blocks cleanup everywhere: look for old `xact_start` in `pg_stat_activity`.
