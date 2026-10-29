# Scratch: notes for Claude

Scratch is a golf handicap tracker: a mobile web app that is installed to the
iOS Home Screen as a PWA. Conner is the owner and main user. This file carries
context between sessions; the commit messages carry the detail (see "History"
below). Update this file when something here stops being true.

## What's in the repo

| File | What it is |
|---|---|
| `index.html` | The app (the public build). |
| `admin.html` | The same app, plus admin-only features (community-course submission inbox, publishing courses directly) gated by `isAdmin()` / `ADMIN_EMAILS`. Different splash/background and its own embedded fonts. |
| `sw.js` | Service worker: push notifications and Home Screen install. Must stay at the web root so its scope covers both pages. Bump `SW_VERSION` when changing it. |
| `index.webmanifest`, `admin.webmanifest` | PWA manifests. |
| `Scratch-backend.txt` | Source of the Cloudflare Worker `scratch-scan` (`https://scratch-scan.conneraltenhoff.workers.dev`). It does two things: scorecard photo scanning and custom game generation through Claude (`POST /`), and course search/data through golfcourseapi.com (`/v1/search`, `/v1/courses/{id}`). The keys live as Worker secrets, never in the app. It is deployed by pasting it into the Cloudflare dashboard, not from this repo. |
| `supabase-test.html` | Standalone Supabase connection test page. |
| `.claude/launch.json` | Local static server: `python3 -m http.server 8123 --bind 127.0.0.1`. |

The manifests and `sw.js` reference `app-assets/…` icons and `scratch-icon.png`,
which are not in this repo.

## How the HTML files are built (read before editing)

Both HTML files are **self-unpacking bundles**, not hand-written pages:

- A loader `<script>` near the top unpacks the bundle on `DOMContentLoaded`.
- `<script type="__bundler/manifest">` holds a JSON map of asset UUID →
  `{mime, compressed, data}` (base64 images, fonts, and compressed JS libraries).
- `<script type="__bundler/template">` holds the **entire app as one
  JSON-encoded string** (~1.6 MB) on a single line. The app source (markup,
  CSS and the main component class) lives inside that string, so in the raw
  file every newline is `\n`, quotes are `\"`, and non-ASCII is `\uXXXX`.

So edit by decoding, changing and re-encoding rather than by text-editing the
raw line. Use `tools/bundle.py`, which reproduces the bundler's exact encoding
(ASCII-only, uppercase `\uXXXX`, and `</` written as `</` so the template
can't close its own `<script>`; plain `json.dumps` gets the last two wrong):

```python
from tools.bundle import load, save
src, doc = load('index.html')
assert src.count(old) == 1
save('index.html', src.replace(old, new), doc)
```

`python3 tools/bundle.py` checks that both files decode and re-encode byte for
byte. Run it before you start. Keep diffs minimal: an untouched file should
produce no diff.

The template uses a custom runtime: `<sc-if value="{{ … }}">` blocks for
conditionals, `{{ }}` bindings, and a `renderVals()` method that computes the
values the template reads. `ref="{{ }}"` does **not** wire up in this runtime;
use a `data-` attribute and find the element in the DOM instead.

**Every app change goes into both `index.html` and `admin.html`.** Their
templates differ slightly (admin has extra blocks), so apply the change to each
and check it landed in both.

## Conventions

- **Bump `BUILD_VERSION`** (in the template, both files) with every
  user-visible change, and add an entry to the in-app changelog array next to
  it (`{ version, date: 'Month YYYY', items: [...] }`). The version is the only
  way to tell on a phone whether a fix is live, so never ship without a bump.
  Changelog entries describe what a user would notice, in plain language;
  invisible changes are left out.
- **Commit messages** follow the existing style: a plain-English subject that
  says what changes for the user ("Keep a buddy's rounds when the buddy goes"),
  then a body explaining the cause, the fix, what was verified and how, and,
  explicitly, what was **not** verified.
- **Verify in a real browser** (Playwright/Chromium against the local server)
  at phone widths, 390 and 375 px, measuring rather than guessing. Demo
  mode gives seeded data; it is cloud-sandboxed and does not persist to
  `fairway_v3`. Notes for doing that in a cloud session:
  - The page loads React from unpkg.com, which the cloud sandbox may block.
    `npm pack react@18.3.1 react-dom@18.3.1` works (the npm registry is
    reachable); serve the UMD files with `page.route`.
  - The app instance is the `.logic` of a `StreamableComponent`'s
    `stateNode`: walk React fibers from any element to reach it.
  - To get past the install gate, set `navigator.standalone = true` in an
    init script. Plant data by writing `fairway_v3` to localStorage before
    load. Without a signed-in account, the sign-in screen still covers most
    screens: call methods directly and read the result, or screenshot sheets
    that sit above it (the course edit sheet does).
  - A `SyntaxError ... appendChild ... Unexpected token '-'` and one 404 on
    boot happen on the untouched app too. They are not regressions.
- Don't guess at the shape of the user's data. Several bugs took three tries
  because fixes were based on assumed data; a device dump (Web Inspector)
  settled it in one step. Ask for one when a bug depends on real data.
- Fix only what was asked; mention anything else found rather than widening
  the change.

## Architecture notes that matter

- **Storage**: local data is in `localStorage` under `fairway_v3` (plus
  `fairway_backup`, `fairway_user_cache`, `fairway_profile_cache`,
  `fairway_buddy_cache`, `fairway_pending_buddy`, `fairway_theme`,
  `fairway_accent`, `fairway_seen_version`, `fairway_scan_url`).
- **Cloud**: Supabase (`krcwphxjzbahocwewbzn.supabase.co`). Tables include
  `app_state` (the synced data blob, one row per user), `profiles`,
  `friendships`, `shared_stats`, `pending_claims`, `push_subscriptions`,
  `community_courses`.
- **All Supabase table calls go over REST** through `_sbRest()` /
  direct fetches, with the token from `_authToken()` and an AbortController
  timeout. Do **not** use `supabase-js` `.from()`: its `getSession()` takes a
  LockManager lock that stalls forever in an installed iOS PWA.
- **Sync** (`cloudPull` / `cloudPush` / `mergeData` / `stampData`): deletions
  are tombstoned in `meta.deleted` with timestamps, so a later `updatedAt`
  wins over a tombstone. There are safety rails that must stay:
  - a pull that would take a device from some rounds to zero is refused;
  - a push whose pre-read of the server copy failed throws instead of writing;
  - `signOut()` only clears local data after reading back the server copy and
    confirming it holds at least as many rounds;
  - `mergeData` keeps the rest of `meta` (migration flags such as
    `fgMigrated`, `girDerived`) and unions `exBuddies`.
- **"Me"**: always resolve the user's own golfer with `meGolfer()`, which
  prefers the active profile. Never look up the literal id `'you'`. The real
  account has an empty duplicate golfer at id `'you'` alongside the real
  profile `conner`.
- **Handicap**: WHS. Differentials use the adjusted gross (each hole capped at
  net double bogey) when a round has all 18 hole scores and the course has
  par and stroke index; otherwise the raw score.
- **Ratings are always 18-hole numbers**, on every tee, including on a 9-hole
  course, where the rating is the one for playing the nine twice. A nine's
  rating is half of it (`_nineRating`), unless the tee has `rating9f` /
  `rating9b`. A rating from 22.5 up to 45 can only be a 9-hole number and is
  doubled (`_fixNineTees`) on load, on every persist and on every merge. Use
  `_par18(course)` wherever a Course Handicap is computed: a 9-hole layout's
  stored par is the nine's.
- **9-hole courses** (`courseIsNine`: a 9-hole layout): Play offers 9 or 18
  holes. `doubleNine` / `singleNine` give the loops odd/even 18-hole stroke
  indexes, ranked from the card's.
- **Nines** are posted through `adjGrossNine` (9-hole Course Handicap, strokes
  given to the hardest holes on that nine, net-double-bogey cap) and then
  `nineToEighteenDiff` (WHS expected-score method). `diff9` is stored when the
  round is saved; `cap9` marks a nine that has been capped.
- **Courses merge newer-wins on `updatedAt`**, like rounds. Anything that
  edits a course must stamp `updatedAt`, or other devices push the old copy
  back.
- **Fairway/green**: FIR is three-state (hit / miss / untracked) and only
  tracked holes count. GIR is derived from score minus putts against par minus
  two, with a tap to override.
- **Badges** are derived from rounds on every render, not stored. "Earned this
  round" is the difference before and after saving.
- **Buddies** see aggregates only (`mySharedPayload`), never round history.
  A removed buddy's golfer and rounds are archived to `data.exBuddies` and
  restored on re-add.
- **iOS quirks**: there's no Vibration API on Safari; timers are suspended in
  the background, so use wall-clock time; the visual viewport sometimes never
  shrinks for the keyboard (see `_kbFitFocus` / `_kbFitReset`).

## History

The current version is in `BUILD_VERSION`; the latest work is in `git log`.
Recent themes, oldest first:

- **Aug 2026, 5.123.x**: iOS sync hangs fixed by moving everything to REST;
  keyboard sheets anchored; game tiles shrink to fit; custom game icons kept
  distinct; the arcade play screen scrolls; the blank Handicap Index fixed
  through `meGolfer()`.
- **Aug–Sep 2026**: QR invite and signup flow fixed; real sync error messages
  shown; a data-loss incident traced to `signOut()` clearing rounds on an
  unverified backup, with the safety rails above added; deleted courses can
  be re-added; Course Average rows expand to their rounds.
- **Sep 2026**: WHS adjusted gross; the landscape stats view fixed (`_slSet`
  was missing); returning guests offered their saved phone number; buddy
  payload trimmed to aggregates; a scored round's course can be changed.
- **Oct 2026, up to 5.142.x**: Play screen rebuilt. OUT/IN/TOT in the header,
  one hole at a time with a hole strip, auto-advance after two idle minutes,
  a full scorecard for solo rounds, the score as the main element, GIR
  derived, an "impossible hole" fix note, a badge sheet at the end of a round,
  and buddies' rounds kept when the buddy is removed.
- **Oct 2026, 5.143.0–5.144.0**: 9-hole courses. Ratings stored as 18-hole numbers
  (with existing data repaired), odd/even stroke indexes when playing the
  nine twice, 18-hole par for Course Handicap, nines capped at net double
  bogey, and tee editing in Edit Course, with courses merging newer-wins;
  then a Full / Off low strokes toggle on the Play card.

## Open items and plans

(Things discussed but not built, known issues, ideas. Add to this, and remove
items once they're done or dropped.) As of 5.142.1, roughly in order of how
much they matter:

1. **Check Point Venture on the real account (5.143.0).** Its 9-hole tee
   ratings (33–34.6) are now doubled automatically on load: White becomes 69.2,
   matching the published 18-hole ratings Conner provided (Black 70.6/124,
   Blue 70.5/124, White 69.2/119, Gold 66.8/110, Red 65.8/101, Silver 54.4/80,
   plus combo tees). Its rounds' saved ratings and past nines are repaired too.
   This was only tested on planted data shaped like it. On the real account,
   confirm the tees read the published numbers (correct any in Edit Course),
   the Course Handicap there is about 15, stroke dots appear, and the Index
   move is believable. There's no scorecard for Point Venture, so its par and
   stroke indexes are unverified.
2. ~~`adjGrossNine` under-allocates on nine-hole rounds.~~ Fixed in 5.143.0.
   The real fault was that nothing called it, so nines posted their raw score.
3. **Vaaler Creek is unconfirmed.** The fourteen dots there are correct for
   CH 14, but the White tee's rating and slope were never checked to confirm
   the 14 itself. If they're off like Point Venture's, the pops are wrong for
   the same reason. Ask Conner for the White tee's rating and slope. They can
   now be corrected in Edit Course.
4. ~~The Play screen has no "strokes off low" option.~~ Added in 5.144.0:
   a Strokes toggle (Full · Off low, default Full, with an (i) explainer) in
   Play setup for groups of two or more. `play.strokes === 'low'` makes the
   dots show `pops` (CH minus the group's lowest CH). `ch` stays the full
   Course Handicap and still drives the net-double-bogey cap and posting.
   **Still open:** the Arcade's `strokesOffLow` uses Handicap *Index*
   differences (`Math.round(idx − low)`) and falls back to 10.0/14.0 when an
   index is missing, so it can disagree with the Play card when tees or slope
   differ. WHS uses Course Handicap differences. Not changed; ask Conner.
5. **`ENFORCE_AUTH` is still `false`** (line 52 of `Scratch-backend.txt`).
   This is the long-standing second stage of the Worker auth rollout. Flipping
   it is a dashboard paste and redeploy, not a commit.

Smaller, discussed and left:

- **A fallback for rounds whose course was deleted.** Such rounds currently
  give a differential of 0, so deleting Plum Creek would move the Index from
  15.6 to 9.2. A fix was offered and not taken up.
- **Whether an unresolved impossible-hole fix note should block
  auto-advance.** Currently it doesn't (chosen deliberately not to trap the
  user); never explicitly confirmed with Conner.
- **An Apple Watch app.** This was a feasibility question, not a request.
- The Arcade guest sheet doesn't offer a returning guest's saved phone number
  yet; only the main Add a Guest sheet does (2d57413).

Unverified on real hardware:

- Whether the badge-sheet haptic fires on Conner's iPhone (f611088).
- Whether the two-minute auto-advance survives the iOS PWA being backgrounded
  in a pocket (c178160).
