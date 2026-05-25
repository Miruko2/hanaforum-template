# Supabase Backup Notes

This folder stores local metadata snapshots for the Supabase project.

## Already Exported

- `openapi-public-schema.json`: exported from Supabase PostgREST OpenAPI metadata.
- `public-schema-summary.md`: readable summary of exposed public tables and RPC endpoints.

These files are useful, but they are not a full database backup. PostgREST OpenAPI does not include RLS policies, indexes, triggers, grants, function bodies, or all constraints.

## Full Metadata Export

1. Open Supabase Dashboard.
2. Go to SQL Editor.
3. Paste and run `supabase-backup/export-full-metadata.sql`.
4. Copy the JSON result.
5. Save it locally as `supabase-backup/full-metadata.json`.
6. Run:

```bash
node scripts/summarize-supabase-metadata.mjs
```

This creates `supabase-backup/full-metadata-summary.md`, including RLS policies, indexes, triggers, functions, grants, realtime tables, and storage buckets.

## Security

Do not commit service role keys, database passwords, or copied user data. This folder is intended for schema and permission metadata only.
