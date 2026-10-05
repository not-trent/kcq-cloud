-- Step 4: enable Realtime replication for live sync across tabs/devices.
-- Step 4: enable Realtime replication for live sync across tabs/devices.
-- Run these statements once in the Supabase SQL Editor. Each ALTER is idempotent
-- for the intended one-time setup only when the table is not already present.
alter publication supabase_realtime add table modules;
alter publication supabase_realtime add table questions;

select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
	and schemaname = 'public'
	and tablename in ('modules', 'questions')
order by tablename;
