alter table public.resources
  add column published_at timestamptz,
  add column relevant_until timestamptz,
  add column time_sensitivity_reason text,
  add column time_sensitivity_confidence numeric(4, 3)
    check (time_sensitivity_confidence between 0 and 1);

comment on column public.resources.time_sensitivity is
  'Base 0..1 estimate of how quickly usefulness declines; effective urgency is calculated at recommendation time.';
comment on column public.resources.relevant_until is
  'Optional evidence-backed deadline after which urgency becomes zero; expiration does not automatically archive the resource.';
comment on column public.resources.time_sensitivity_reason is
  'Short evidence-based explanation for the time-sensitivity estimate.';
comment on column public.resources.time_sensitivity_confidence is
  'Confidence from 0..1 in the extracted time-sensitivity metadata.';
