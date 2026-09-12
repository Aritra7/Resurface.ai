# Resurface.AI Web MVP Scope

## Product promise

Resurface.AI selects the most useful combination of saved resources for the goals, energy, and time a user has now.

## Required vertical slice

The web MVP is complete when a user can:

1. Create or enter a demo account.
2. Choose up to three goals and one current focus.
3. Save Instagram, YouTube, and ordinary web URLs.
4. Review or correct automatically suggested metadata.
5. Choose a 2, 5, 10, or 20 minute session.
6. Receive a diverse queue that does not exceed the time budget.
7. See a deterministic explanation for every selection.
8. Complete, snooze, or archive every resource.
9. Generate a later queue that reflects those decisions.

## Required web routes

- `/` - product promise and entry points
- `/login` - account access
- `/onboarding` - goals, primary focus, and default time
- `/dashboard` - backlog and session entry point
- `/add` - URL capture and assisted categorization
- `/session/new` - time and energy selection
- `/session/[id]` - queue and sequential revisit experience
- `/history` - completed sessions
- `/settings` - goals and defaults

## Required platform support

- Instagram: store permalink, optional user note, and user-confirmed category; revisit in Instagram.
- YouTube: store link metadata and duration when available; otherwise use a content-type default.
- Web articles: store title, description, canonical URL, and estimated reading time.

Metadata failure must never prevent a link from being saved.

## Deferred until the vertical slice is stable

- Native mobile applications
- Instagram Saved collection import
- Gmail OAuth and newsletter forwarding
- Browser extension
- Whisper transcription and video-frame analysis
- Push notifications
- Semantic search or chat
- Collaboration and public collections
- Screenshot, PDF, or video archival

## Technical boundaries

- The queue optimizer and feedback behavior are original Resurface.AI code.
- Third-party projects may be studied, but code reuse must be isolated, licensed, attributed, and recorded.
- Secret keys stay server-side.
- Content ingestion rejects unsafe local-network targets and limits response sizes.
- The same optimizer input must produce the same output.

## Demo acceptance test

Given fitness Reels, short videos, technical tutorials, and articles in the backlog:

1. A two-minute session produces a short queue within budget.
2. A twenty-minute session produces a different, higher-depth queue.
3. Raising Programming to the current focus changes the chosen resources.
4. Completing and archiving resources changes the next queue.
5. Every recommendation displays a reason tied to an actual scoring signal.
