-- Temporary diagnostic: lets the migration script verify whether Realtime replication is really enabled.
-- Safe to drop afterward; not part of the app schema.
create or replace function kcq_debug_realtime_publications()
returns table(schemaname text, tablename text)
language sql
security definer
as $$
  select schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';
$$;
