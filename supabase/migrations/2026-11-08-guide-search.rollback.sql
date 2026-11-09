-- Rollback for 2026-11-08-guide-search.sql
-- Drops only the guide-search objects. modules, questions and the screenshots
-- bucket are untouched. Run this if the pilot library is rejected.

drop function if exists public.search_guide_chunks(text, uuid, integer, boolean);
drop table if exists guide_chunks;
drop table if exists guide_sources;
drop table if exists guide_documents;

-- Existing application data is unaffected; verify with:
--   select count(*) from modules;
--   select count(*) from questions;
