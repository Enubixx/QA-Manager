-- Adds Bug Type and Priority to the bugs table so triage choices are stored on the bug itself
-- (until now they were only kept inside each test run's copy of the bug).
-- Safe to run more than once. Run it once in Supabase: Dashboard > SQL Editor > New query > paste > Run.

-- 1) The two new fields (empty for now)
alter table public.bug_logs add column if not exists bug_type text;
alter table public.bug_logs add column if not exists priority text;

-- 2) Copy the values bugs already have from their test runs (active and archived), without overwriting anything set.
with run_bugs as (
  select elem->>'id' as id, elem->>'bugType' as bug_type, elem->>'priority' as priority
  from public.test_runs, jsonb_array_elements(coalesce(bug_logs::jsonb, '[]'::jsonb)) as elem
  union all
  select elem->>'id', elem->>'bugType', elem->>'priority'
  from public.archived_runs, jsonb_array_elements(coalesce(bug_logs::jsonb, '[]'::jsonb)) as elem
),
per_bug as (
  -- one value per bug (a bug is normally in a single run)
  select id, max(bug_type) filter (where bug_type is not null) as bug_type,
             max(priority) filter (where priority is not null) as priority
  from run_bugs where id is not null group by id
)
update public.bug_logs b
set bug_type = coalesce(b.bug_type, l.bug_type),
    priority = coalesce(b.priority, l.priority)
from per_bug l
where b.id = l.id and (b.bug_type is null or b.priority is null) and (l.bug_type is not null or l.priority is not null);

-- 3) Make the app see the new columns right away
notify pgrst, 'reload schema';
