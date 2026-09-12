-- Backfill resources imported before ingest set status and scoring fields.
--
-- Imports landed with the `unreviewed` default and null scoring columns, while
-- /session/new only loads `active` and `snoozed`. Every imported resource was therefore
-- invisible to the optimizer. New imports are fixed in ingest.ts; this repairs existing rows.
--
-- Only rows that came from a connector are touched. Anything a user typed in by hand
-- keeps whatever status they gave it.

update public.resources
set status = 'active'
where status = 'unreviewed'
  and source in ('youtube', 'instagram', 'browser_bookmark');

-- Neutral midpoints where a signal is unknown. The optimizer already defaults nulls to
-- 0.5 internally, so this changes no ranking; it makes the stored data self-describing
-- rather than leaving the intent implicit.
update public.resources
set actionability = coalesce(actionability, 0.5),
    cognitive_effort = coalesce(
      cognitive_effort,
      case
        when content_type in ('short_video', 'social_post') then 0.2
        when estimated_minutes >= 30 then 0.8
        when estimated_minutes >= 15 then 0.65
        when content_type = 'video' then 0.45
        else 0.5
      end
    ),
    time_sensitivity = coalesce(time_sensitivity, 0.15)
where source in ('youtube', 'instagram', 'browser_bookmark');
