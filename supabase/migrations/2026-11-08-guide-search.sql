-- KCQ Cloud: module-guide full-text search (additive)
--
-- Adds a text-only reference library for recovered module guides:
--   guide_documents  one row per distinct extracted text (deduplicated by content hash)
--   guide_sources    one row per recovered export, keeping notebook/file provenance
--   guide_chunks     section-aware passages with character offsets into a named text version
--
-- Storage rule: the guide text is stored once, as chunks. There is no separate
-- document body column, and no PDFs/HTML/images are uploaded.
--
-- Safe to run more than once. Creates no tables that already exist and does not
-- touch modules, questions or the screenshots bucket.

-- The project's schema.sql already enables pgcrypto. gen_random_uuid() is core
-- in PostgreSQL 13+, so no extension is required here.

create table if not exists guide_documents (
  id uuid primary key default gen_random_uuid(),
  content_hash text not null unique,
  title text not null,
  text_version text not null,
  char_count integer not null check (char_count >= 0),
  chunk_count integer not null default 0 check (chunk_count >= 0),
  classification text not null default 'guide'
    check (classification in ('guide', 'assessment', 'generated', 'unrelated', 'ambiguous')),
  classification_reason text,
  completeness text not null default 'unknown'
    check (completeness in ('substantial', 'partial', 'unknown')),
  quality_flags jsonb not null default '[]'::jsonb,
  review_status text not null default 'pending_review'
    check (review_status in ('approved', 'pending_review', 'rejected')),
  stated_module text,
  stated_edition text,
  page_map text not null default 'none'
    check (page_map in ('none', 'partial_footer', 'continuous_footer')),
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists guide_sources (
  id text primary key,
  document_id uuid not null references guide_documents(id) on delete cascade,
  title text not null,
  notebook text,
  archive_path text,
  original_type text,
  module_id uuid references modules(id) on delete set null,
  module_assignment text not null default 'unassigned'
    check (module_assignment in ('validated', 'proposed', 'unassigned')),
  module_evidence text,
  created_at timestamptz not null default now()
);

create table if not exists guide_chunks (
  id bigserial primary key,
  document_id uuid not null references guide_documents(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  heading text,
  text text not null,
  char_start integer not null check (char_start >= 0),
  char_end integer not null check (char_end >= char_start),
  page_ref integer check (page_ref is null or page_ref > 0),
  page_ref_status text not null default 'none'
    check (page_ref_status in ('none', 'verified_footer', 'unverified')),
  page_ref_evidence text,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(heading, '') || ' ' || text)
  ) stored,
  unique (document_id, chunk_index)
);

create index if not exists guide_chunks_search_idx on guide_chunks using gin (search_vector);
create index if not exists guide_chunks_document_idx on guide_chunks(document_id);
create index if not exists guide_sources_document_idx on guide_sources(document_id);
create index if not exists guide_sources_module_idx on guide_sources(module_id);
create index if not exists guide_documents_review_idx on guide_documents(review_status);

-- Read-only for the public app credentials, like modules/questions. Writes stay
-- with the service role, so the ingestion script remains the only writer.
alter table guide_documents enable row level security;
alter table guide_sources enable row level security;
alter table guide_chunks enable row level security;

drop policy if exists "guide_documents_public_read" on guide_documents;
create policy "guide_documents_public_read" on guide_documents
  for select using (true);

drop policy if exists "guide_sources_public_read" on guide_sources;
create policy "guide_sources_public_read" on guide_sources
  for select using (true);

drop policy if exists "guide_chunks_public_read" on guide_chunks;
create policy "guide_chunks_public_read" on guide_chunks
  for select using (true);

-- Ranked keyword retrieval. Module-filtered results first, then unassigned
-- material when p_include_unassigned is true. Page numbers are returned only
-- when the ingestion script verified a footer page map.
create or replace function public.search_guide_chunks(
  query_text text,
  p_module_id uuid default null,
  p_limit integer default 6,
  p_include_unassigned boolean default true
)
returns table (
  chunk_id bigint,
  document_id uuid,
  source_id text,
  title text,
  heading text,
  chunk_text text,
  char_start integer,
  char_end integer,
  page_ref integer,
  page_ref_status text,
  completeness text,
  page_map text,
  module_id uuid,
  module_assignment text,
  rank real,
  snippet text
)
language sql
stable
security invoker
set search_path = public
as $$
  with lex as (
    select coalesce(array_agg(lexeme), '{}'::text[]) as arr, count(*)::int as n
    from (
      select distinct lexeme
      from unnest(tsvector_to_array(to_tsvector('english', coalesce(query_text, '')))) as lexeme
      where length(lexeme) > 2
      limit 16
    ) terms
  ),
  q as (
    -- OR the question's content words. AND semantics (websearch_to_tsquery)
    -- returns nothing for a full question plus its options.
    select case
      when lex.n = 0 then 'zzzznomatch'::tsquery
      else to_tsquery('english', (select string_agg(quote_literal(word), ' | ') from unnest(lex.arr) as word))
    end as tsq,
    lex.arr,
    lex.n
    from lex
  ),
  matched as (
    select distinct on (c.id)
      c.id as chunk_id,
      c.document_id,
      s.id as source_id,
      s.title,
      c.heading,
      c.text as chunk_text,
      c.char_start,
      c.char_end,
      c.page_ref,
      c.page_ref_status,
      d.completeness,
      d.page_map,
      s.module_id,
      s.module_assignment,
      ts_rank_cd(c.search_vector, q.tsq) as rank
    from guide_chunks c
    join guide_documents d on d.id = c.document_id
    join guide_sources s on s.document_id = d.id
    cross join q
    where d.review_status = 'approved'
      and c.search_vector @@ q.tsq
      -- Most natural-language words appear somewhere in 9,200 chunks. Requiring
      -- several distinct query words to be present stops a single common word
      -- ("describe", "process") from passing a passage off as a match.
      and (
        select count(*)
        from unnest(tsvector_to_array(c.search_vector)) as word
        where word = any (q.arr)
      ) >= least(3, greatest(1, q.n))
      and (
        p_module_id is null
        or (s.module_assignment = 'validated' and s.module_id = p_module_id)
        or (p_include_unassigned and s.module_assignment <> 'validated')
      )
    order by c.id, (s.module_id = p_module_id) desc nulls last, s.id
  ),
  -- Rank first, headline only the passages actually returned: ts_headline on
  -- every OR-match costs more than the anon statement timeout allows.
  top as (
    select * from matched
    order by rank desc, chunk_id
    limit greatest(1, least(coalesce(p_limit, 6), 25))
  )
  select
    t.chunk_id, t.document_id, t.source_id, t.title, t.heading, t.chunk_text,
    t.char_start, t.char_end, t.page_ref, t.page_ref_status, t.completeness,
    t.page_map, t.module_id, t.module_assignment, t.rank,
    ts_headline(
      'english'::regconfig,
      coalesce(t.heading, '') || ' ' || t.chunk_text,
      q.tsq,
      'MaxFragments=2,MaxWords=30,MinWords=8,StartSel=«,StopSel=»'
    ) as snippet
  from top t
  cross join q
  order by t.rank desc, t.chunk_id;
$$;

-- Supabase creates the anon/authenticated roles; a plain PostgreSQL instance may
-- not have them, so grant only where they exist.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'grant execute on function public.search_guide_chunks(text, uuid, integer, boolean) to anon, authenticated';
  end if;
end $$;
