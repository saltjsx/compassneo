<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/wordmark-dark.svg">
    <img src="packages/brand/logo/wordmark.svg" alt="Compass Neo" height="48">
  </picture>
</p>

<p align="center">
  <b>A faster, friendlier way to use <a href="https://www.compass.education">Compass</a>.</b><br>
  Your timetable, grades, work, files, attendance and more, in one place that is actually nice to open.
</p>

<p align="center">
  <a href="https://compassneo.app"><b>compassneo.app</b></a>
</p>

> [!NOTE]
> Compass Neo is an unofficial client, built by a student. It is not made by, endorsed by or affiliated with Compass
> Education or the WA Department of Education.

## What it does

- **Today, at a glance.** The day's classes with rooms, teachers (with their photos), relief and room changes, the
  lesson plan, and what is due. Step between days; the week back and the fortnight ahead are already synced.
- **Every class in one panel.** Press a class for its lessons, grade, assessments, work, notices, files and classmates,
  pulled from Compass and (at WA public schools) Connect, side by side.
- **Canvas too.** At a school that runs Canvas beside Compass, add it from your profile and its assignments join your
  to-do list and each class's work, its modules the class's files, its announcements the class's notices, and its marks
  your grades, each on the right class.
- **Grades that make sense.** Every assessment with its weighting, how your mark has moved, where you sit in the class,
  and *where you could finish*: "get 70% on the rest and you finish on 74%".
- **Your last lesson before it's due.** Every piece of work still to do says when the class meets for the last time
  before it is due ("Last lesson Thursday, P3"), or that there are no lessons of it left.
- **Hand work in.** Upload to a Compass learning task or a Connect submission without leaving the app.
- **Files that open.** PDFs, images, videos, YouTube and Loom open in place; grab a whole folder as one zip.
- **You, too.** Attendance by term, class and period, your events and excursions, and your Chronicle.
- **Notices, read for you.** The school's daily notices summed up in a line on home, the rest as bullet points (with
  their files) a press away, and the assemblies they announce shown on your timetable in place of the classes they take.
- **Your timetable in your own calendar.** A link your phone's calendar subscribes to, with what Compass's own feed
  leaves out: room changes, relief teachers, assemblies in place of the lessons they take, and when work is due.
- **Stays signed in.** Compass signs everyone out daily. Compass Neo doesn't.
- **Pretty.** Dark (by default), light or auto, springy motion, and a colour for every class.

## Privacy and security

Compass Neo has to sign in to Compass as you, so here is exactly what it keeps:

- Your **username and password are encrypted** (AES-256-GCM) with a key only the server holds, and bound to your
  account, so they only ever decrypt for you. They are used for one thing: signing back in when Compass ends your
  session.
- Your **Compass and Connect sessions** are encrypted the same way under a second key, and never leave the server.
  Files are passed through short, signed links.
- Your **devices hold a random token**, and the server keeps only its hash.
- **Signing out of your last device deletes your account**, your login and everything synced for it.
- If Compass rejects your saved login (say you changed your password), it is forgotten and you are asked to sign in.
- **Canvas**, if you add it, is read with an access token you make in Canvas yourself. It is encrypted the same way as
  your password, used only to read, and deleted when you remove Canvas or sign out of your last device. Deleting the
  token in Canvas stops it working at once.
- Sign-in attempts are rate limited.
- The **school's notices** (its news feed, never anything of yours) are sent to Anthropic's Claude API to be read into
  bullet points, once per notice per school, when the server has an API key.

- The **calendar feed** is off until you ask for a link. The link is the only key to it (a calendar app cannot sign
  in), so anyone with it can see your timetable; turning it off ends it, and turning it on again makes a new one.

It reads from Compass, Connect and Canvas, and writes only when you hand in work on Compass or Connect, after asking you
first. Nothing is ever handed in on Canvas: its work opens on Canvas.

## Stack

```
apps/web            React Router 8 (SPA mode), Glaze design system retuned for Compass Neo
packages/backend    Convex: school directory, sign-in, sessions, sync, caches
packages/compass    fetch-only Compass client, shared by every runtime (Convex, and later phone and watch)
packages/connect    fetch-only client for WA DET Connect (grades, content, submissions), same login as Compass
packages/canvas     fetch-only, read-only client for Canvas LMS (courses, work, modules, announcements), own token
packages/brand      logo SVGs and brand colours for clients that cannot read CSS tokens
```

[Bun](https://bun.sh) workspaces, [Convex](https://convex.dev) for the backend, [motion](https://motion.dev) for the
springs, [Solar](https://github.com/480-Design/Solar-Icon-Set) icons, and [Glaze](https://design.how) for the
design system. Hosted on Vercel.

## Run it

```sh
bun install
bun run dev:backend      # convex dev, in packages/backend (sign in to Convex the first time)
bun run dev              # web on http://localhost:5175
```

`apps/web/.env.local` needs `VITE_CONVEX_URL` (the `CONVEX_URL` from `packages/backend/.env.local`), and `VITE_MEDIAN_PUBLIC_KEY` (the `median_pk_...` half of the Median key, safe in a browser) for the help button.

Convex env (`npx convex env set ...` in packages/backend):

| Variable | What |
|-|-|
| `SESSION_KEY` | 32 random bytes, base64. Seals Compass and Connect session cookies. Rotating it only costs a fresh sign-in per account (done automatically with the stored login). |
| `CREDENTIALS_KEY` | 32 random bytes, base64. Seals each account's username and password. Rotating it makes every device sign in again. Set it separately on every deployment (dev and prod). |
| `MEDIAN_KEY` | The Median key (`median_key_...`), for the support agent's tools at `/api/median` (`convex/lib/median.ts`) and for signing who a student is to the help button (`convex/median.ts`). Server only. |
| `ANTHROPIC_API_KEY` | A Claude API key, for reading the school's notices with Claude Haiku 5.5 (`convex/ai.ts`). Optional: without it notices show as posted, with no bullet points or assemblies. Once set, the next sync reads the last ten days' notices. |

Make a key with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Deploy

- **Backend:** `bun run --filter @compassneo/backend deploy` (`convex deploy`), then set both keys with
  `npx convex env set --prod ...`.
- **Median:** after a backend deploy, re-sync the support agent's tools so Median's copy matches the code:
  `median tools endpoint sync` (or `curl -H "Authorization: Bearer $MEDIAN_KEY" https://<deployment>.convex.site/api/median`).
  Tool names are unique per Median organisation, so only one deployment's `/api/median` can be connected at a time.
- **Web:** Vercel builds the repo root with `vercel.json` (`bun run build`, serving `apps/web/build/client` with every
  path falling back to `index.html`). Set `VITE_CONVEX_URL` to the production Convex URL.

Other useful scripts: `bun run typecheck`, `bun run test` (bun's own runner: the Canvas client in `packages/canvas`,
and the backend's pure logic in `packages/backend/test`, kept outside `convex/` so it is never deployed), and
`bun run lint` (Glaze's lint) before shipping a screen.

# How it works

## How it talks to Compass

- **No browser.** compass-education drives Chromium because Compass's web login waits on a Cloudflare Turnstile
  check. The endpoint Compass's own phone apps use, `POST /services/admin.svc/AuthenticateUserCredentials`, takes
  `{username, password}` as JSON and returns the same session cookies, so `packages/compass` signs in with fetch.
  Endpoint shapes for data (calendar, tasks, feed, attendance) are ported from compass-education and its extras.js.
- **Cloudflare fingerprints clients.** Node and Bun's fetch get challenged from a home connection; Convex's default
  runtime passes. Keep Compass calls in Convex actions without `"use node"`.
- **Schools.** Compass's school search (`schools.compass.education/api/v1/schoolsearch/search`) is open and returns
  names and organisation ids. The address lookup behind it needs a Turnstile token bound to Compass's site, so the
  slug is found by guessing (`thornlieshs-wa`, `mckinnonsc-vic`) and proving each guess against the login page's
  `<h1 class="schoolName">`. Proven schools are cached in Convex for everyone; misses are remembered for three days;
  a person can always paste their address instead.
- **Logins are kept, sealed.** Compass ends sessions daily, so each account (school + username) stores its login
  under `CREDENTIALS_KEY` (AES-256-GCM, bound to the account so a ciphertext only opens on its own row). Any Compass or
  Connect call that finds its session ended signs in again with it and retries once (`convex/lib/compass.ts`,
  `convex/lib/connect.ts`). A sign-in that hiccups (a 5xx, Cloudflare turning one request away, a session that comes
  back empty, the network dropping it) is tried again up to three times with doubling, jittered waits
  (`packages/compass/src/retry.ts`, and the same in `packages/connect`); a wrong password or two-step sign-in never is,
  so retries cannot bring a lockout closer. The sign-in form retries the trip to Convex itself, and Compass being busy
  once more. If Compass rejects the stored login (password changed), the account is forgotten and its
  devices are asked to sign in. Signing out the last device deletes the account and its login. Devices hold only a
  random token; Convex keeps its SHA-256. Sign-in attempts are limited to six per account per ten minutes.

## Connect (WA)

WA public schools also have DET Connect, which holds assessment outlines and grades and signs in with the same DET
login. `packages/connect` signs in without a browser: `/login/student` redirects to the DET single sign-on (Oracle
Access Manager) form on login.det.wa.edu.au, which takes `ssousername`, `password`, `acceptterms` and its hidden
`request_id`, then redirects back with Connect's cookies. Data calls are `POST /connectapi/rest/api/v1/...` with
`X-XSRF-TOKEN` from the `CONNECT_XSRF` cookie, behind a read-only allow-list (ported from the connect-sdk, which
captured the portal's own calls). Grades are cached per account (`connectCache`) and shown at once; a refusal is shown in
place and retried after 6 hours.

Reading an assessment outline (`getGrades` in packages/connect) has traps, all seen on a real account:

- An outline can be split into parts (Science's "Chemical Sciences", HASS's "Term 3 - HIS"): tasks sit in
  `taskGroups[].groups[]` as well as `taskGroups[].tasks`. Every level is read; each task keeps its part's name.
- An outline shared with another course lists that course's tasks too, with no maximum and no weighting. Those are not
  assessed for the student and are left out.
- A subject's mark is Connect's own `groupResultsData.mark` ("67.92%") when it gives one (`percentOf`), else the
  weighted average of the marked tasks (`scoreOf`). Each task counts `mark / maximumMark * weightedMaximumMark`:
  Connect's `weightedMark` is rounded to a tenth and summing it drifts (50.3 for 50.7).
- Weightings need not total 100 (Maths' semester 2 totals 61), so a task's share of the grade is its weighting out of
  the outline's total.
- One learning area can hold two outlines the same semester (Health and General PE are both "Health and Physical
  Education"). Those are named for their outlines, so they never share a class or a history.

Everything else Connect holds for a class is read the same way, behind the same allow-list (`packages/connect/src/more.ts`):
Learning Content (`learningcontent/root/DomainSchoolClass/<id>/`, then each section's `contents?view=PUBLISHED`), the
submission board and the student's own entry on each, the class's learners, and My Connect attendance. Handing work in is
the one write, kept out of the allow-list on purpose: `handIn` uploads the file to the class
(`files/upload/DomainSchoolClass/<id>?uploadType=FILE&purpose=ATTACHMENT&context=SUBMISSION`) and attaches it to the
submission (`submission/<id>/saveStudentSubmission`), the same two calls Connect's own upload dialog makes.

## Canvas

Many schools run Canvas beside Compass: Compass for the timetable, attendance and reports, Canvas for each course's work,
files and announcements. A student adds it from the profile card with the school's Canvas address and an access token
(Account, Settings, New access token). `canvas.add` checks both with Canvas itself (`/users/self`) and keeps the token
sealed under `CREDENTIALS_KEY`, beside the Compass login.

**Why a token.** Every school puts its own sign-on in front of Canvas: Microsoft, Google, or an identity service of its
own, often with a second step. Each is a different flow, and replaying one without a browser means storing the
student's school password for a site that is not Compass, and breaking whenever the school changes its sign-on. An
access token is what Canvas documents for an app reading the API as the student; it works the same at every school, can
be deleted from Canvas at any time, and is the only thing kept.

The Canvas address is whatever the student types, so it and everything a server there says are untrusted: an address
has to be a public name (`publicHost`: no IP addresses, no `localhost`, `.internal`, `.local` and the like), and a
file's download link is followed by hand, every hop checked the same way and https. `packages/canvas` only ever sends
`GET`, and only to an allow-list of paths; every list follows Canvas's `Link` header
to a cap. Ids stay strings (`application/json+canvas-string-ids`): Canvas's global ids pass 2^53.

The sync reads it after Compass and Connect, full runs only (`convex/sync.ts`, `runCanvas`): the student's active
courses (with teachers and their score), each course's assignments with the student's own submission and its assignment
groups (`work:<courseId>` rows in `canvasCache`: the assignments due in the last 120 days or later, and every assignment
that counts towards a grade all year, lean, for the grades step), with their descriptions kept apart (`text:<courseId>`,
under a byte budget) so the queries that read every course's work stay small, and the last three weeks' announcements,
and the grades worked out from them (below). A class's panel fetches its course's assignments again when they are over
five minutes old. If the courses step fails, the later steps use the courses as last kept. A token Canvas refuses is
noted on the account (`canvasRefused`, only if it is still the account's token): Canvas is left alone, Compass carries
on, and the profile asks for a new token.

**Which class.** `lib/match.ts` `matchCourses` gives each timetable class its course: by code first (a course coded
`8SCI` is class `8SCI2`), else by shared teachers and the rarer words of the names, each word counting by how many
courses have it, so "Digital Technology" and "Food Technology" do not match on "technology". Each course goes to
one class. Some schools keep formal assessments, or the year's notices, in a course of their own; an assignment or
announcement in a course no class claims goes to the class its name names (`classForName`: the class's subject or its
course's name, its code without the year, "CT", or the short name, "Maths"), else to none (`lib/courses.ts`).

**Where it stands.** `canvasState` reads the student's own submission, never Canvas's upcoming list (which keeps work
already handed in): handed in (late or not), excused, locked, missing or past its date (overdue), still to do, or `none`
when it is not handed in on Canvas (on paper, or an exam's notice). On home's To do, Canvas work is listed when it has a
date (Canvas's own to-do leaves undated work out too): still to do, overdue for four weeks (Canvas marks everything not
handed in as missing all year, quizzes nobody chased up among it), and work not handed in on Canvas the way Compass's
offline tasks are. Each class's Work shows all of it beside Compass's and Connect's, with an "Open in Canvas" in place of
handing in, and the class's notices take its course's announcements.

**Grades.** A school without Connect gets the Grades row from Canvas (`lib/grades.ts`): the sync's grades step works
them out from the courses and assignments already kept (`canvas.keepGrades`, no call to Canvas) in Connect's own shape,
with a grade history beside them (`lib/history.ts`), so the Grades row, the Grades page and each class's grade read them
unchanged, through `gradeRows`. Many schools keep formal assessments in a course of their own, each named for its
subject, while a class's own course fills with homework, checkpoint quizzes and class activities that carry points but
are not the grade. A mark that reaches a class from a course no class claims (named for it: `classForName`) is formal,
and once two or more classes get formal marks the school works that way: each subject's grade is its formal assessments
alone, never its homework or Canvas's own score for the course (which blends the homework in), and a subject with
nothing formal marked yet has no mark. Formal marks for no current class make a subject of their assignment group (last
semester's Commerce), once the student has a mark in it, since such a course is shared by the whole year. A school
without such a course gets each course as Canvas marks it: its own score when it shows one, else its assignments that
count. Weightings are the teacher's own, written into each task ("Task weighting 25%", `writtenWeight`), when every task
in the subject states one and they make the whole; else Canvas's group weights where a course uses them; else none, and
a subject is its points out of all of them. No share of the grade is ever guessed. Work whose assignment group or course
names a semester ("Commerce Semester 1", "Drama Sem2") is that semester's; the rest is the semester it is now. A
history begun under an earlier way of working Canvas's grades out starts again (`canvasReading`), so the change never
reads as a jump. A class finds its subject through its course (`subjectMatcher`), the same course its work and files
come from.

**Files.** A class's Files tab takes its course's modules (`resources.ts`), one folder per module in the teacher's
order: many schools hide a course's Files from students, and the modules are where the content is anyway. A module whose
items Canvas leaves out of the list (a course with very many) has them asked for on their own. A file opens
through Compass Neo's own file route like Compass's and Connect's (`lib/links.ts`, source `canvas`): the route asks
Canvas for the file with the token and fetches its short-lived download link (signed for the student, so the token
never goes with it), and a file over the route's limit is left to Canvas. Pages, assignments, quizzes, discussions and
outside links open where they are. Each side of a class's Files and Work is fetched on its own, so Compass not
answering never holds Canvas back.

## Sync

`convex/sync.ts` fetches an account in runs, one step after another, each step written to a `syncs` row as it starts
and ends; results land in `compassCache` and `connectCache`. An account has one run at a time, so Compass and Connect
each see one session from us. Two kinds:

- **Full:** Compass (profile and photo, the timetable from a week back to a fortnight on, learning tasks in full, news,
  attendance, events, Chronicle, teachers' photos), then Connect at a WA school (sign-in, classes, notices, grades,
  work, attendance), then Canvas when the student has added it (courses, work, announcements).
- **Quick:** only what changes minute to minute: the timetable from yesterday to a week on, learning tasks, news. No
  Connect.

**Durable.** A run is never an action a client waits on: it is a job in a workpool (`convex/pools.ts`,
`@convex-dev/workpool`). The mutation that writes the run enqueues its job in the same transaction. Runs someone is
waiting on go in `syncPool`; background ones go in the narrower `backgroundPool`, so they never hold up a sign-in. A
job that crashes is tried again (with backoff) and picks up where it stopped: it reads the run again and skips the steps
already settled. A job that fails every try, or is called off, is ended by the pool's `onComplete` (`sync.done`): the
steps left are marked failed with the reason. An account forgotten mid-run (a password changed) is not retried. A run
counts as in flight from the moment it is queued. A queued run is let go after 30 minutes without starting, and a
started one after 10 minutes without a step (no action runs longer). The last five runs are kept, plus the latest full one.

**When.** The server decides what each request gets:

| Asked by | Gets |
|-|-|
| Signing in, "Sync now" | a full run, at once |
| Opening the app, or an open tab about once a minute | a full run if the last full one is over 15 minutes old, else a quick one if the last run is over 40 seconds old, else nothing |
| The background, every 15 minutes | a full run, unless a full one finished in the last 10 minutes |

A tab asks only while it is in front of someone (`useAutoSync`, `lib/neo/sync.ts`): first at a random point in its first
minute and a half, then every 55 to 65 seconds, so devices opened together drift apart. A hidden tab asks nothing, and
asks at once when shown again. A request that finds a background run still queued takes its place in `syncPool`.

**Load balanced.** A cron ticks every minute (`sync.tick`). It takes the accounts whose `nextSyncAt` has come, by index and
in bounded batches (50 per mutation, at most six chained per minute; the rest wait for the next tick), and enqueues their
runs as one batch. Each account sits at its own phase in the quarter hour, a hash of its id, so the background load is
spread evenly. A new account (or one from before the scheduler) is given its phase first. After each turn
`nextSyncAt` moves on a whole turn, keeping the phase; an account a whole turn behind goes back to its phase from now
instead of catching up in a burst. An account with a run in flight is just moved on. An account no device has opened
in three days drops to hourly, still on its phase.

**Signed out behind its back.** If a background run finds the stored login rejected, nobody is there to hear it. So when
`lib/compass.ts` forgets an account, each device is left a farewell under its token's hash (`farewells`, kept a week,
cleared by the hourly sweep). An open app reads it (`accounts.farewell`) and lands on sign-in with the reason; a
device opened later hears it from `sync.now`.

The app shows a sync without naming what it fetches, and only a run someone is watching (signing in, opening the app,
"Sync now"). After a sign-in the form wipes away and the compass becomes the progress: the dial fills like a gauge, the
needle sweeps across it and finds north when the run is done, then the app opens. It waits at most 20 seconds, or 5 if
the run has not started; past that, the run carries on behind the app. An account that was synced before (another
device, a sign-in again) does not wait at all. `auth.signIn` says it is `cached` (today's timetable is already kept), so
the needle swings once to north and the app opens on the cached data while the run carries on behind it. Home shows only
the gauge, as an icon in the corner. It pulses for watched runs
and rests through the quiet ones. Press it to sync; its tooltip says when the account last synced, by any run. Home
always shows the last synced data.

## Timetable

`convex/timetable.ts` keeps one `compassCache` row per school day (`day:YYYY-MM-DD`, empty on a day without classes) and
a `classes` row of every class seen lately. The `day` query joins each lesson to its teacher's name, its colour, its
Connect grade and its learning tasks (`convex/lib/match.ts`), so every client gets the same answer. A day outside the
synced window is fetched when someone opens it (`load`). Relief teachers and room changes come from Compass's covering
fields. Teacher codes ("jsmith") become names from Connect's teacher lists; a class is matched to its Connect subject by
shared teachers first, then by subject words. Teachers' photos come from a lesson's own page
(`Activity.svc/GetLessonsByInstanceIdQuick`, `ManagerPhotoPath`), because Compass refuses teachers' profiles to students;
the sync's people step copies Compass's square thumbnail into storage (`convex/teachers.ts`). Each class gets one of twelve hues, unique while a student has twelve
classes or fewer. Days are bucketed in the school's state time and shown in its IANA zone (`lib/days.ts` on both sides).

## Announcements

Schools announce assemblies in their daily notices, and Compass's timetable never changes for them. So the sync's news
step reads the notices with Claude, and the timetable shows the assemblies (`convex/announcements.ts`).

- **Fetching.** `packages/compass/src/news.ts` asks `NewsFeed.svc/GetMyNewsFeedPaged` (the feed on Compass's web home
  page: `{ start, limit }`, each item's HTML in `Content1` and `Content2`), and `Feed.svc/GetFeedItems` when that fails
  or is empty. Neither shape has been checked against a real account: each field is read under every name it is known
  by, the HTML becomes plain text (paragraphs, "• " list items, table rows split by " | "), and the step's note says
  which call answered, which field held the words and what fields the items had (in full in the logs and in the
  student's `news` row). Attached files are named, not read.
- **Once per school.** Each item is one `announcements` row (school slug and item id) shared by every student who sees
  it; a student's `news` row in `compassCache` lists the items they see, and only those are ever shown to them. A row
  keeps a SHA-256 of the title and text, so an edited notice is read again. A new or changed item posted in the last ten
  days is queued in `aiPool` (`convex/pools.ts`: three at a time, retried with backoff) by the same mutation that saw
  it, under a 30-minute lease, so syncs racing at one school queue it once.
- **Reading.** `convex/ai.ts` (Node runtime: the API is not behind Compass's Cloudflare) asks Claude Haiku 5.5 for
  structured output: the notice's kind, a summary of a sentence or two written to the student (what changes their day
  first: it stands in for the notice on home), bullets (one fact each, dates resolved), assemblies (day,
  times or periods, year levels or a narrower group, place, notes, confidence) and any revised bell schedule. The
  system prompt never changes, so it caches; the post date and the school's zone go in the user message. Rate limits,
  overload and dropped connections are thrown for the pool to retry; a refusal, a digest cut short or one that does not
  fit the schema is failed for good; an API rejection is tried again after six hours. Without `ANTHROPIC_API_KEY`
  nothing is sent: items are kept as skipped and shown as posted.
- **Over the timetable.** Assemblies are laid over a day when it is read (`convex/lib/assemblies.ts`, from the `day`
  query), never written into the stored days, so a corrected notice just lays differently. One for other year levels is
  left out. One for a narrower group, one Claude was unsure of, or any for a student whose form group does not start
  with their year ("10B" is Year 10) is a maybe. Times come from the notice, else from the student's lessons in the
  periods it names, counted as the app counts them (`periodsOf`, homeroom no period), since a notice's "Period 3" is
  the period students call 3. A lesson an assembly covers is marked "Assembly instead"; one it overlaps, "Assembly 9:00
  – 9:40, then class". A revised bell schedule read slot by slot moves the lessons' times (Compass's kept as `timesWas`).
- **Files.** A notice's attachments are kept with where they are (`packages/compass/src/news.ts`): a path on the
  school's own Compass (an asset id becomes `FileAssets.svc/DownloadFile`, as Compass's news page links it; a link to
  anywhere else is only ever linked to, never fetched with the session), opened through the file route like a class's
  files (`lib/links.ts`), so they open in the viewer. The attachments' field names are in the news step's note, as the
  feed's are.
- **On screen.** On home, under the classes, one row and never the notices themselves
  (`features/home/announcements.tsx`): Claude's summary of the latest day's notices, two lines at most, and the next
  assembly that is for the student. It opens Notices in the side panel, as Attendance and Events open
  (`features/student/notices.tsx`): the assemblies coming up, the latest day's notices (summary, bullets, files, the
  notice as posted a press away; as posted until they have been read, or if they cannot be), older days under Earlier.
  Refreshing there runs a sync. On the day, an assembly is a cell among the classes at its time (`AssemblyCard`,
  `AssemblyNote` in `features/timetable/class-card.tsx`).

## Beyond the timetable

Found in Compass's own page scripts (`assets-cf-prod.compass.education/StaticAssetsN/PageScripts/*.js`, public) and
Connect's Angular bundle, and checked against a real account (`packages/compass/src/more.ts`, `packages/connect/src/more.ts`):

| What | Compass | Connect | Convex |
|-|-|-|-|
| Resources | `Wiki.svc/GetActivityAndSubjectResourcesNode` (the class's whole tree) | Learning Content | `resources.ts`, per class, on demand |
| Work | learning tasks in full (sync), hand-in: `FileUpload/FileUploadHandler` then `LearningTasks.svc/CreateTaskStudentSubmission` | submission board, hand-in (above) | `work.ts` |
| Classmates | refused to students | the class's learners | `learners.ts` |
| Attendance | rolls by class (`Attendance.svc/GetAttendanceSummary`), days by term | the year's absences, this term by period | `attendance.ts` (sync) |
| Events | calendar entries that are not classes (excursions, clubs, assemblies, exams) | | `events.ts` (sync) |
| Chronicle | `ChronicleV2.svc/GetUserChronicleFeedThin`, asked for every category in `GetRelevantCategories` (an empty list means none) | | `chronicle.ts` (sync) |

Files from either side need the account's session, which never leaves Convex, so the app links to Compass Neo's own
route instead: `GET /file/<link>/<name>` (`convex/http.ts`). Each link names one file of one account under an HMAC
(`convex/lib/links.ts`, keyed from `SESSION_KEY`), and dies with the account. A file over 19 MB is sent back to Compass.

Handing work in writes to Compass or Connect exactly as their own upload windows do: the file goes to Convex storage
first (`work.uploadUrl`), `work.submit` passes it on and deletes it, and the app asks before sending.

## Class panel

Pressing a class opens everything about it in a panel at the side (`apps/web/app/features/class/`), fed by one query,
`classes.detail` (`convex/classes.ts`): the class's lessons in the weeks around the day being looked at, its teachers,
both semesters of grades with every assessment, its learning tasks, and its notices from Connect (the Connect class is
found by code, then by name and the notices' authors). Labelled tabs, each its own scroll, shown only when they have
something: Overview (the lesson, its plan, the grade, what is due, notices, next lessons, a Classmates card from Connect),
Grades, Work (Compass's learning tasks and Connect's submissions together, each opening to its instructions,
attachments, what was handed in and a place to hand in, with a confirm step: `features/class/work.tsx`), Files (both
sides' resources as one library of folder rows that open in place, newest Connect items first, lesson plans folded at
the bottom, select or a folder's "Download all" to zip: `files.tsx`), Lessons. The panel widens for Files: beside the day
when the window has room (`dayRoom` in `features/panel/side-panel.tsx`), over it when not. The day prefetches every class
on it, so the panel usually opens full.

Sources show as the real logos (`components/brand/source-mark.tsx`: Compass's compass ring, Connect's knot), never as
words. Files and videos open in the viewer over the app (`features/viewer/`, `lib/neo/viewer.ts`): a file is fetched
with a spinner and shown in place when the browser can (PDF, image, video, audio, text), else saved without leaving the
page; YouTube and Loom play in it; many files download as one zip made in the browser (fflate). Any other web link
opens a new tab.

## The student's own pages

Under the day, three tiles open Attendance, Events and Chronicle in the same side panel as a class (one panel at a time;
going between them swaps in place). `features/student/`:

- Attendance: the year's share of rolls present, each class's rolls, days by term (Compass), and the current term
  period by period (Connect).
- Events: grouped by month, a weekly club as one row with its sessions, "You went" where Chronicle records it.
- Chronicle: a one-line tally (house points, commendations, events), then the entries by month in hairline rows; an
  entry opens to the teacher's note in place, never a list of Compass's field prompts.

Connect shows marks with no dates, so grade history is kept here: each grades fetch writes the change to a `history`
row in `connectCache` (`convex/lib/history.ts`), a point whenever a subject's score moves and the moment each mark first
appeared. Marks already there when an account's history began are its baseline and have no day.

## Calendar feed

`convex/calendar.ts`: the timetable as the app shows it, as iCalendar for a phone's or laptop's calendar to subscribe
to, at `GET /calendar/<link>/compass-neo.ics` (`convex/http.ts`). It is built from what the sync keeps, never with a
call to Compass, from a week back to as far ahead as days are kept (the sync's fortnight, and further where someone
opened a day). Each lesson says its room and teacher, and when a relief teacher, a room change, a revised bell schedule
or an assembly has changed it; assemblies and the day's other entries are entries of their own; work still to hand in
(the To do list, below) sits on the day it is due as an all-day entry with the time in its title. Times are UTC, all-day
entries the school's own dates (`lib/ics.ts`).

The days are read with the day query's own reader (`readDays` in `convex/timetable.ts`), which reads what every day
shares once, so a feed of two months costs little more than one day.

A calendar app cannot sign in, so the link is the key: a signed token (`signToken` in `lib/links.ts`, under its own
domain so it can never pass for a file link) naming the account and a random value kept on it (`calendarNonce`). The
profile card turns the feed on (`calendar.enable`, which makes the value), gives the link to copy or as `webcal://` to
open in the device's calendar, and turns it off (`calendar.disable`, which clears it); a link whose value is not the
account's current one answers 410. Signing out deletes the account, and the link with it.

## Grades and to-do on home

Under the day, **Grades** is one row, always there and never folded (`features/home/grades-row.tsx`): every subject's
grade as its own ring, in one row however many there are, centred (`features/home/grade-rings.tsx`), each in its class's
colour (ring, glyph in the middle and score under it alike). It opens Grades in the side panel
(`features/student/grades.tsx`, fed by `overview.grades` in `convex/overview.ts`), which has two levels and nothing that
drops down. The overview: the rings again (each opens its subject), the subjects with their latest mark and trend, the marks as they came in
(from the grade history), what is still to be marked (with the Compass task or Connect submission of the same name for
when it is due and whether it is in), and the other semester. Any of those opens the subject's own page, in its colour:
**What you need** (the average needed on everything not yet marked to finish on 80, 65 or 50%, or that it is locked in
or out of reach, from the outline's weightings), then the class panel's own grade sections (`features/class/pages.tsx`:
the grade against the class, the grade as it built up, where it could finish, the semesters side by side, every
assessment, what changed), and what is still to come in it, with a way into the class. A school without Connect has no
row, unless the student has added Canvas (see Canvas, above).

Under it, above the classes, **To do** folds like the class list and starts folded, its count and how much is overdue in
the heading (`features/home/todo-list.tsx`, fed by `convex/overview.ts` from what the sync keeps). It lists every piece
of work not handed in: Compass's learning tasks still to do, and Connect's open submissions, whose boards the sync's
Connect work step reads for every current class (`work.fetchConnectWork`, at most eight classes). Canvas's assignments
join them when the student has added Canvas (see Canvas, above). Every overdue piece comes first and is always shown,
however late (for as long as Compass's kept tasks or the Connect board hold it); then what is coming up, five at a time.
A Compass task with nothing to hand in online is listed from a fortnight before its date to a week after (overdue then),
since nothing online says whether it went in on paper. A row opens its class on its Work. Each piece still to come says
its class's last lesson before it is due, here and on its own page in the class panel (`convex/lib/lessons.ts`): the
last lesson of that class still to start before the due date, read from the kept days (periods counted as the timetable
counts them), "no lessons left" when every day up to the due date is kept and none has one, and nothing when a day
before it is not kept (the sync fetches a fortnight ahead). The class list under it starts folded too: the day above
already shows today's classes.

## Design

Glaze from design.how, retuned in `apps/web/app/components/glaze/tokens.css`: Glaze's neutral surfaces and ink,
Neo blue as the only accent (primary glass, focus, a focused field, small glaze), Outfit for the wordmark and login titles,
rounder shells. Light, dark (default) and auto themes, chosen in the profile card or on the sign-in screen
(`lib/neo/theme.ts`, applied before first paint). The brand layer (`apps/web/app/components/brand/`) holds the logo
components, the compass motion and the view-transition morphs (`apps/web/app/lib/neo/morph.ts`); the timetable's pieces
are in `apps/web/app/features/timetable/timetable.css`. Follow `.claude/skills/glaze/SKILL.md` for UI work and run
`bun run lint` (Glaze's lint) before shipping a screen.

Motion runs on springs: `motion` (`lib/neo/motion.ts`) in React, and `--ease-spring` (a `linear()` spring) for view
transitions. The class panel floats in from the right while the day springs aside on the same spring (from 760px wide;
a phone gets it over the screen), the profile photo grows into its card, the mark flies between the login and the app,
and a new day slides in while the block's height springs to fit.

Icons are Solar (`@solar-icons/react`) in the filled Bold style, all through `components/glaze/icon.tsx`; the room switch
and the relief mark are the line style, so they sit lighter beside the word they qualify.

Deliberate departures from stock Glaze, all asked for: a brand accent, class colours (twelve OKLCH hues), springs with a
little overshoot, a sheen and lit top edge on the surfaces (still no shadows), gradients on the grade rings and bars, a
class-coloured wash and tab thumb in the class panel, filled icons, and the bezel drawing behind the login mark.
