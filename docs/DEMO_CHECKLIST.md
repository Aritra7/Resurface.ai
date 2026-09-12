# Local demo checklist

## One-time setup

1. Apply every migration through `202609120009_settings_and_resource_editing.sql`.
2. Fill `.env.local` from `.env.example`.
3. Run `pnpm install` and `pnpm dev`.
4. Sign in as the same Supabase user that owns the imported resources. Row-level security deliberately prevents one teammate's account from seeing another teammate's saves.

## Core walkthrough

1. Open **Resources** and confirm real saved items appear.
2. Search for a title and filter by category and state.
3. Open **Edit details** on one item, correct its categories, linked goal, duration, actionability, time sensitivity, or effort, and save.
4. Open **My path** and confirm the resource appears under its linked goal.
5. Build a session, choose a priority, time, and energy level, then preview the optimizer queue.
6. Reorder one item or remove it to demonstrate re-curation.
7. Start the session and choose Complete, Snooze, Archive, or Skip for every item.
8. Open **Progress** and verify the completed resource and session are reflected.
9. Open **Settings**, change the main focus or reminder time, save, and return to the dashboard.

## Verification commands

```bash
pnpm test
pnpm lint
pnpm build
pnpm extension:package
```

The in-app reminder appears at or after the configured local time when at least one active resource exists. Email delivery, public OAuth callbacks, and continuously scheduled maintenance remain deployment concerns.
