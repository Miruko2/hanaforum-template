-- Supabase metadata export helper.
--
-- Run this whole file in Supabase Dashboard -> SQL Editor.
-- It returns multiple rows: one row per metadata section. This format is
-- easier to copy from the SQL Editor than one very large nested JSON object.
--
-- Save the result as supabase-backup/full-metadata.json, then run:
--   node scripts/summarize-supabase-metadata.mjs

SELECT section, data
FROM (
  SELECT
    10 AS sort_order,
    'tables' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'kind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity,
        'comment', obj_description(c.oid, 'pg_class')
      )
      ORDER BY n.nspname, c.relname
    ), '[]'::jsonb) AS data
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')

  UNION ALL

  SELECT
    20 AS sort_order,
    'columns' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'table_schema', c.table_schema,
        'table_name', c.table_name,
        'column_name', c.column_name,
        'ordinal_position', c.ordinal_position,
        'data_type', c.data_type,
        'udt_name', c.udt_name,
        'is_nullable', c.is_nullable,
        'column_default', c.column_default,
        'character_maximum_length', c.character_maximum_length,
        'numeric_precision', c.numeric_precision,
        'numeric_scale', c.numeric_scale,
        'datetime_precision', c.datetime_precision,
        'is_identity', c.is_identity,
        'identity_generation', c.identity_generation,
        'is_generated', c.is_generated,
        'generation_expression', c.generation_expression
      )
      ORDER BY c.table_schema, c.table_name, c.ordinal_position
    ), '[]'::jsonb) AS data
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'

  UNION ALL

  SELECT
    30 AS sort_order,
    'constraints' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'table_name', cl.relname,
        'constraint_name', con.conname,
        'constraint_type', con.contype,
        'definition', pg_get_constraintdef(con.oid, true)
      )
      ORDER BY n.nspname, cl.relname, con.conname
    ), '[]'::jsonb) AS data
  FROM pg_constraint con
  JOIN pg_class cl ON cl.oid = con.conrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT
    40 AS sort_order,
    'indexes' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'schema', schemaname,
        'table_name', tablename,
        'index_name', indexname,
        'definition', indexdef
      )
      ORDER BY schemaname, tablename, indexname
    ), '[]'::jsonb) AS data
  FROM pg_indexes
  WHERE schemaname = 'public'

  UNION ALL

  SELECT
    50 AS sort_order,
    'policies' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'schema', schemaname,
        'table_name', tablename,
        'policy_name', policyname,
        'permissive', permissive,
        'roles', roles,
        'command', cmd,
        'using_expression', qual,
        'with_check_expression', with_check
      )
      ORDER BY schemaname, tablename, policyname
    ), '[]'::jsonb) AS data
  FROM pg_policies
  WHERE schemaname = 'public'

  UNION ALL

  SELECT
    60 AS sort_order,
    'triggers' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'trigger_schema', trigger_schema,
        'trigger_name', trigger_name,
        'event_manipulation', event_manipulation,
        'event_object_schema', event_object_schema,
        'event_object_table', event_object_table,
        'action_timing', action_timing,
        'action_orientation', action_orientation,
        'action_statement', action_statement
      )
      ORDER BY event_object_schema, event_object_table, trigger_name, event_manipulation
    ), '[]'::jsonb) AS data
  FROM information_schema.triggers
  WHERE event_object_schema = 'public'

  UNION ALL

  SELECT
    70 AS sort_order,
    'functions' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'schema', n.nspname,
        'name', p.proname,
        'arguments', pg_get_function_arguments(p.oid),
        'result', pg_get_function_result(p.oid),
        'language', l.lanname,
        'security_definer', p.prosecdef,
        'volatility', p.provolatile,
        'definition', pg_get_functiondef(p.oid)
      )
      ORDER BY n.nspname, p.proname, pg_get_function_arguments(p.oid)
    ), '[]'::jsonb) AS data
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language l ON l.oid = p.prolang
  WHERE n.nspname = 'public'

  UNION ALL

  SELECT
    80 AS sort_order,
    'grants' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'grantor', grantor,
        'grantee', grantee,
        'table_schema', table_schema,
        'table_name', table_name,
        'privilege_type', privilege_type,
        'is_grantable', is_grantable,
        'with_hierarchy', with_hierarchy
      )
      ORDER BY table_schema, table_name, grantee, privilege_type
    ), '[]'::jsonb) AS data
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'

  UNION ALL

  SELECT
    90 AS sort_order,
    'sequences' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'sequence_schema', sequence_schema,
        'sequence_name', sequence_name,
        'data_type', data_type,
        'start_value', start_value,
        'minimum_value', minimum_value,
        'maximum_value', maximum_value,
        'increment', increment,
        'cycle_option', cycle_option
      )
      ORDER BY sequence_schema, sequence_name
    ), '[]'::jsonb) AS data
  FROM information_schema.sequences
  WHERE sequence_schema = 'public'

  UNION ALL

  SELECT
    100 AS sort_order,
    'extensions' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'name', e.extname,
        'version', e.extversion,
        'schema', n.nspname
      )
      ORDER BY e.extname
    ), '[]'::jsonb) AS data
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace

  UNION ALL

  SELECT
    110 AS sort_order,
    'realtime_publication_tables' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'publication_name', pubname,
        'schema', schemaname,
        'table_name', tablename
      )
      ORDER BY schemaname, tablename
    ), '[]'::jsonb) AS data
  FROM pg_publication_tables
  WHERE pubname = 'supabase_realtime'

  UNION ALL

  SELECT
    120 AS sort_order,
    'storage_buckets' AS section,
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'name', name,
        'owner', owner,
        'public', public,
        'file_size_limit', file_size_limit,
        'allowed_mime_types', allowed_mime_types,
        'created_at', created_at,
        'updated_at', updated_at
      )
      ORDER BY id
    ), '[]'::jsonb) AS data
  FROM storage.buckets
) metadata_sections
ORDER BY sort_order;
