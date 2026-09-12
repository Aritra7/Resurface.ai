# Onboarding UX Recommendations

The onboarding MVP should require at most four short screens and take less than 90 seconds. Replace numeric or High/Medium/Low goal ranking with one simpler question: **What matters most right now?** The selected goal receives a primary weight of `1.0`; other selected goals receive `0.65` and remain eligible.

## 1. Promise

**Title:** Make "saved for later" happen.

**Copy:** Resurface picks the best things you saved for the time you have.

Actions:

- **Get started**
- Try with sample saves
- Skip setup, using an Explore interests goal, a 10-minute default, and reminders off

Do not show this screen again after onboarding is complete.

## 2. Choose goals

**Title:** What do you want your saves to help you do?

**Copy:** Choose up to three. This helps us tell useful from merely interesting.

Suggested options:

- Learn something
- Improve fitness
- Grow my career
- Cook more
- Plan a trip
- Enjoy downtime
- Add my own

Require one to three goals. Custom goals are limited to 40 characters, trimmed, and deduplicated. On mobile, use tappable cards rather than drag-and-drop.

## 3. Choose a main focus

Skip this screen when only one goal was selected.

**Title:** What matters most right now?

**Copy:** We will favor this goal when two saves compete. Your other goals still appear.

Render only the selected goals as single-select cards. Do not expose weights or ask users to order every goal. Back navigation preserves selections; deselecting the primary goal clears it.

## 4. Choose a default session

**Title:** How much time do you usually have?

**Copy:** This is only a starting point. You will confirm it every session.

Options:

- 5 min - quick reset
- 10 min - balanced, preselected
- 20 min - deep dive

Keep reminders under a collapsed More options section and default them to off. Request notification permission only after the user enables reminders or completes a useful first session.

## First-resource empty state

**Title:** Add your first save

**Copy:** Paste any Instagram, YouTube, newsletter, or article link. We will estimate what it is and how long it takes.

Show one prominent URL field. Reveal "Why did you save this?" only after a valid URL is entered. If enrichment fails, retain the link with fallback metadata. Also offer six sample saves so a judge can reach the optimizer immediately.

After the first save, show:

```text
Saved. Add two more for a better first queue.

[Add another] [Build my first queue]
```

Never require three resources; a one-resource queue remains valid.

## Interaction requirements

- Show progress for goals, focus, and session duration only.
- Persist the draft through refresh and Back navigation.
- Save goals, primary goal, time, and completion atomically.
- Use a centered card up to approximately 640px on desktop.
- Use a sticky bottom action and controls at least 44px tall on mobile.
- Keep schedules, integrations, optimizer weights, energy mode, and category correction out of onboarding.
- Returning users with completed onboarding go directly to the dashboard.

## Acceptance criteria

1. Setup takes under 90 seconds in a basic usability test.
2. A user cannot continue without one to three valid goals.
3. One goal bypasses the main-focus screen; multiple goals require one focus.
4. The UI never exposes numeric weights.
5. Session duration defaults to 10 minutes and is described as changeable.
6. Notification permission appears only after explicit intent.
7. Refresh and Back preserve the draft.
8. The first-resource form validates HTTP(S) URLs and survives enrichment failure.
9. Sample saves provide a fast path into the optimizer.
10. At 375px, no content scrolls horizontally and the main action stays visible.
