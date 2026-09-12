# Resurface.AI: Complete Product Flow

> The right save at the right time.

## 1. Product summary

People save useful Instagram posts, YouTube videos, newsletters, articles, and other resources with the intention of returning to them. Most of those saves disappear into separate platform-specific backlogs.

Resurface.AI brings those resources into one queue and decides what should be revisited next. It does not optimize for clicks or scrolling time. It optimizes for the likelihood that a saved resource will be useful, completed, and turned into action within the time the user has available.

The core loop is:

```text
Capture -> Understand -> Prioritize -> Schedule -> Revisit -> Decide -> Learn
```

## 2. Installation and access

### 2.1 Intended user installation

The first hackathon version should be a responsive web app that can also be installed as a Progressive Web App (PWA).

1. The user opens the Resurface.AI website.
2. They create an account or continue with Google.
3. On mobile, they select **Add to Home Screen** when prompted.
4. On desktop, they install the optional Resurface browser extension.
5. They allow notifications so Resurface can deliver scheduled queues.

The application remains usable without the extension. Users can always paste a URL into the web app.

### 2.2 Capture integrations

The eventual product can expose several capture mechanisms:

- A mobile share extension: **Share -> Resurface**
- A desktop browser extension: **Save to Resurface**
- A URL field inside the app
- A personal email address for forwarded newsletters
- A Gmail connection for messages explicitly labeled `Resurface`
- Screenshot upload for content whose metadata cannot be retrieved
- Browser bookmark import

For the hackathon MVP, implement URL paste and a browser extension first. A mobile share extension and Gmail connection can be presented as follow-on integrations if time is limited.

### 2.3 Developer installation status

The repository does not yet contain an application scaffold, dependency manifest, or environment-variable template. Exact development commands must be added after the stack is selected. Do not publish placeholder commands that cannot run.

Once implementation begins, this section should contain:

```text
Prerequisites
Clone repository
Install dependencies
Copy the environment template
Configure database and authentication
Run database migrations
Start the development server
Run tests
```

The root README should remain the canonical source for tested developer installation commands.

## 3. First-time onboarding

Onboarding should take less than two minutes. Its purpose is to give the optimizer an initial model before it has observed any behavior.

### Step 1: Explain the promise

```text
You already saved it. Resurface helps you actually use it.

Bring links from Instagram, YouTube, newsletters, and the web into one queue. We will recommend a small set when you have time.
```

### Step 2: Choose active goals

The user selects or creates goals such as:

- Improve fitness
- Learn programming
- Advance my career
- Cook more often
- Plan a trip
- Read for enjoyment

Goals are editable. A category describes what a resource is about; a goal describes why it matters to the user.

### Step 3: Rank priorities

Ask the user to order their goals or assign each one a simple priority:

```text
High: Learn programming
Medium: Improve fitness
Low: Plan a trip
```

Avoid asking for numerical weights. Internally, the application can convert High, Medium, and Low into initial weights.

### Step 4: Set revisit preferences

Ask for:

- Preferred reminder days
- Preferred reminder time
- Default session duration, such as 5, 10, or 20 minutes
- Whether to include entertainment resources
- Notification permission

This duration is a default, not an assumption that the user is free. Every session allows the user to change it.

### Step 5: Add the first resources

Give the user three choices:

```text
[Paste a link] [Install browser extension] [Try sample saves]
```

Sample saves make it possible to demonstrate the optimizer before the user has built a backlog.

## 4. Capturing resources

Every capture path should produce the same normalized resource record.

### 4.1 Instagram posts and Reels

Instagram does not provide an endpoint for reading a consumer's Saved collection. Resurface therefore uses an explicit share flow:

```text
Instagram -> Share or Copy Link -> Resurface -> Confirm -> Save
```

Resurface stores the permalink, not a copy of the Reel. For public, embeddable posts, the product may use an approved Instagram embed for display. Otherwise, **Open in Instagram** is always available.

If only a URL is available, the capture screen asks for one lightweight signal:

```text
Why did you save this?
[Fitness] [Programming] [Food] [Travel] [Other]
```

The user can optionally add a note such as "try this shoulder exercise." A shared screenshot can be analyzed with OCR or a vision model, provided the user deliberately supplies it.

Private, deleted, restricted, or unavailable posts remain links that can be opened only by an authorized user inside Instagram. Resurface must not scrape a user's Saved page or download media through unofficial services.

### 4.2 YouTube videos and Shorts

The user shares or pastes a YouTube URL. Resurface can retrieve permitted metadata such as the title, channel, thumbnail, description, and duration.

Duration is especially important:

- A Short generally fits a quick session.
- A five-minute tutorial fits a normal session.
- A 45-minute lecture should be reserved for a deep-dive session.

The resource opens in YouTube or an allowed embedded player. Completion feedback is collected when the user returns to Resurface.

### 4.3 Gmail newsletters

Support two levels of integration:

**MVP: forwarding**

Each user receives a personal ingestion address. They forward a newsletter to that address. The backend extracts the sender, subject, readable text, received date, and links.

**Later: Gmail label connection**

The user authorizes Gmail and chooses an explicit label such as `Resurface`. Only messages carrying that label are imported. This provides a narrower and more understandable permission boundary than reading the entire inbox.

Newsletters may be treated as one resource or split into individual linked stories. The capture screen should preview the result before saving many items.

### 4.4 Web articles and Google results

The user saves the final article URL, not the Google search-results page whenever possible. The browser extension captures the current page's URL, title, selected text, and optional note.

If a search-result URL is submitted, Resurface should follow only safe, explicit redirects and identify the canonical destination.

### 4.5 Other sources

TikTok, Reddit, podcasts, documents, and other sources use the same fallback hierarchy:

1. Use a supported platform API when available.
2. Use user-shared URL and permitted public metadata.
3. Use user-supplied text, note, or screenshot.
4. Store only the link and ask the user for a category.

Failure to retrieve metadata should never prevent a user from saving a resource.

## 5. Normalizing and categorizing resources

### 5.1 Normalized resource model

Regardless of source, each resource becomes a common record:

```json
{
  "source": "instagram",
  "type": "short_video",
  "url": "https://www.instagram.com/reel/example/",
  "title": "Shoulder mobility routine",
  "summary": "A short sequence of shoulder mobility exercises.",
  "categories": ["fitness", "mobility"],
  "goal_ids": ["improve-fitness"],
  "estimated_minutes": 1,
  "actionability": 0.9,
  "time_sensitivity": 0.2,
  "saved_at": "2026-09-12T12:00:00Z",
  "status": "unreviewed"
}
```

### 5.2 Processing pipeline

```text
Receive resource
    -> Validate and normalize URL
    -> Identify source and content type
    -> Retrieve permitted metadata
    -> Extract or accept user-provided text
    -> Estimate duration and cognitive effort
    -> Detect duplicates
    -> Predict categories and relevant goals
    -> Ask for confirmation when confidence is low
    -> Add to backlog
```

### 5.3 Category versus goal

These should remain separate:

```text
Category: Programming
Topic: OAuth
Goal: Build my authentication project
```

A single resource can belong to multiple categories and support multiple goals. The user can correct any automatic classification. Corrections are strong feedback for future categorization.

### 5.4 Duplicate handling

Resurface should detect:

- The same canonical URL saved more than once
- Shortened and full versions of the same URL
- A newsletter link that has already been saved separately
- Highly similar resources covering the same topic

Exact duplicates can be merged. Similar resources should remain separate but receive a redundancy penalty when queues are assembled.

## 6. Asking what the user wants to prioritize

Priority is captured at three levels.

### Long-term priorities

Configured during onboarding and editable in settings:

```text
1. Learn programming
2. Improve fitness
3. Plan travel
```

### Resource-specific intent

At save time, users may mark an item:

- Important
- Time-sensitive
- Just curious
- For a specific goal

This is optional so saving stays fast.

### Session context

Immediately before generating a queue, ask:

```text
How much time do you have?
[2 min] [5 min] [10 min] [20 min] [Deep dive]

What kind of energy do you have?
[Quick and easy] [Focused] [Surprise me]
```

The time budget comes from the user. Resurface may suggest a duration based on the default schedule or previous sessions, but the user confirms or changes it.

## 7. The optimizer

### 7.1 Individual resource score

Each eligible resource receives a score based on normalized signals:

```text
base_score =
    0.30 * goal_relevance
  + 0.20 * expected_value
  + 0.15 * urgency
  + 0.15 * age_boost
  + 0.10 * completion_probability
  + 0.10 * context_fit
```

Initial weights can be fixed and explained. Later, they can adapt to the user's behavior.

Important signals include:

- Goal relevance: relationship to the user's stated goals
- Expected value: likelihood of teaching something useful or enabling an action
- Urgency: whether the information may expire
- Age boost: how long it has waited
- Completion probability: whether this user completes similar content
- Context fit: whether it matches the current time and energy budget

### 7.2 Queue optimization

The app should not simply return the highest-scoring items. It selects a collection that maximizes total expected value while satisfying constraints:

```text
Maximize:
    sum(resource scores)
  - topic redundancy
  - format redundancy
  - repeated-skip penalty

Subject to:
    total estimated duration <= session budget
    unavailable resources are excluded
    topic and format diversity rules are satisfied
```

This can be implemented as a small knapsack or integer optimization problem. A greedy heuristic is acceptable for the MVP if the scoring and constraints are visible and testable.

### 7.3 Fairness and backlog health

Short videos must not permanently crowd out longer resources. Use:

- An age boost for neglected items
- An exploration slot for uncertain categories
- A weekly deep-dive recommendation
- A limit on highly similar resources in one queue
- A decision prompt after repeated skips: schedule or archive

### 7.4 Explainability

Every recommendation should include a short reason:

```text
Why this is here:
- Supports your highest-priority goal
- Fits your 10-minute session
- Saved 14 days ago
```

This makes the optimization understandable and gives users a way to correct it.

## 8. Revisit session

### Step 1: Reminder

At the configured time:

```text
Your 10-minute Resurface queue is ready.
```

The user can start, change the duration, snooze the reminder, or skip without penalty.

### Step 2: Queue preview

Show the proposed resources, total duration, and recommendation reasons. The user can replace an item before starting.

### Step 3: One resource at a time

The session is finite. There is no infinite feed. Each item opens in an allowed embed, browser tab, source application, or email reader.

### Step 4: Require a decision

When the user returns:

```text
[Completed] [Snooze] [Archive]
```

Optional high-value actions include:

- Save a takeaway
- Create a task
- Schedule practice
- Generate a flashcard
- Revisit later through spaced repetition

### Step 5: Session summary

```text
9 minutes completed
3 resources revisited
2 useful
1 archived
1 action created
```

## 9. Learning from behavior

Resurface must distinguish attention from value:

```text
Opened                     -> weak positive signal
Completed                  -> medium positive signal
Marked useful              -> strong positive signal
Created an action or note  -> very strong positive signal
Archived immediately       -> strong negative signal
Snoozed                    -> timing signal, not a quality judgment
Skipped repeatedly         -> lower priority or wrong context
```

The system should optimize for useful completion, not raw clicks. Otherwise, short entertaining videos will dominate exactly as they do in social feeds.

## 10. Failure and edge cases

- **Metadata retrieval fails:** save the URL and request a one-tap category.
- **Resource is private:** deep-link to the source application.
- **Resource was deleted:** offer Archive or Find an alternative.
- **Duration is unknown:** use a type-based default and allow correction.
- **User has too few saves:** offer samples or generate a smaller queue.
- **Nothing fits the selected time:** show the shortest resource or ask to increase the budget.
- **Notifications are disabled:** display the queue on the home screen and explain how to enable reminders.
- **A newsletter contains many links:** ask whether to save the whole issue or selected stories.

## 11. Privacy and user control

Resurface should follow these principles:

- Import only content the user explicitly shares, forwards, uploads, or labels.
- Request the narrowest integration permissions possible.
- Never request an Instagram password or scrape private Saved collections.
- Do not download or republish platform media without permission.
- Show what information was extracted from each resource.
- Let users edit categories, disconnect integrations, export data, and delete their account.
- Keep private notes and newsletter content private by default.

## 12. Hackathon MVP

The MVP should prove the optimization loop rather than maximize the number of integrations.

### Must have

- Account or demo profile
- Goal selection and priority ordering
- URL capture
- Support for at least Instagram, YouTube, and web articles
- Automatic or assisted categorization
- Estimated duration
- User-selected session budget
- Optimized, diverse queue
- Complete, snooze, and archive actions
- Explanation for each recommendation
- Session summary

### Nice to have

- Browser extension
- Screenshot classification
- Newsletter forwarding
- Gmail label integration
- Notifications
- Adaptive weights
- Notes, tasks, or flashcards

## 13. Three-minute demonstration flow

1. State the problem: people save valuable content across disconnected platforms and rarely return.
2. Save an Instagram fitness Reel, a YouTube programming video, and a technical article.
3. Show Resurface categorizing them and estimating their duration.
4. Set programming as the highest-priority goal.
5. Choose a two-minute session and show the optimizer select the short Reel or another compact resource.
6. Change the budget to twenty minutes and show a different queue led by the technical resource.
7. Open one resource, return, and mark it useful or convert it into an action.
8. Show the updated backlog and explain that future queues learn from that outcome.

The key message is:

> Social platforms optimize what keeps people scrolling. Resurface.AI optimizes what leaves them glad they spent the time.
