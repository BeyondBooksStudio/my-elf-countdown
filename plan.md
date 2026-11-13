# Implementation plan — My Elf Countdown

## Product scope

Create a private, responsive Christmas countdown planner for a parent and child to use together. Parents sign in using the existing Manus OAuth flow, then use a six-digit grown-up PIN to unlock parent-only planner controls. A parent chooses a child display name, a 12- or 24-day countdown and its start date; edits daily elf notes, low-prep activities and one parent-defined good-behaviour target for each active day; adds a per-day treat and its matching private elf image; and may save that pair as an editable template to reuse on another day. A target must be set before its day can be checked complete; changing a target clears that day's completion until the new target is completed. Children do not get accounts: they use a parent-managed, read-only child view. Day 1's treat can be shown when the countdown begins; checking off Day N after its target is complete unlocks Day N+1's saved treat and paired image automatically, with no manual reveal switch. Seed original stories, ideas, daily notes and sample rewards. Use positive, noncompetitive language; do not add punishment, public sharing, ads, rankings or child-photo collection. Build the app in Preview and do not publish publicly without a separate request.

## Design direction

The visual sources are the user's supplied planner video and elf image: a warm, charming countdown with a childlike elf in a red winter outfit, snowy firs, golden lights, gifts, a personalized child-name heading, a clear day grid and golden-star rewards. Use original, reference-guided artwork without copying the watermark or sign text.

- **Design movement:** Contemporary storybook illustration meets tactile paper ephemera; polished, friendly and quietly magical rather than toy-like or noisy.
- **Core principles:** (1) One clear action per screen. (2) Celebrate trying and togetherness, not perfect streaks. (3) Keep parent controls distinct and PIN-locked. (4) Keep the child view simple, warm and readable.
- **Color philosophy:** Deep evergreen provides calm structure; warm cream and paper-white keep the planner legible; cranberry red adds a small festive accent; soft brass/goldenrod marks stars and rewards; icy blue is a quiet winter contrast. Bright red is not used for errors or failure.
- **Layout paradigm:** A desk-side planner composition with compact top navigation, a broad paper-like working area, an editorial elf illustration as the welcome and a compact side details panel. On small screens, collapse navigation and stack cards instead of squeezing the calendar.
- **Signature elements:** An original helper-elf mark; hand-cut paper/card edges and ruled planner lines; gold star tokens for positive progress.
- **Interaction philosophy:** A parent must enter a PIN for parent data and management. Each active day has an editable good-behaviour target and a visible parent-only checkbox; it stays unavailable until a target is present. Entering child view revokes the temporary parent unlock and removes parent data from the browser query cache. Child mode is read-only; its server query includes only day-one or already-unlocked child-facing rewards. Checking off a good deed immediately fills the gold-star progress, counts remaining stars down and unlocks the following day's treat-and-elf-image pair; undoing completion restores a star and locks that next-day reward again. Changing the target clears its previous completion. Completion adds a kind acknowledgement, never a missed-day penalty.
- **Animation:** Give each newly earned star one small, springy pop and animate the progress fill smoothly; support reduced motion; no looping snow or distracting sparkle effects.
- **Typography system:** Use the requested Comic Sans family across the app, with Comic Neue, Chalkboard SE and cursive fallbacks when Comic Sans is unavailable; keep instructions readable with clear spacing and accessible contrast.
- **Brand essence:** A tiny seasonal ritual planner for families that combines imaginative elf moments with gentle good-deed celebrations. Personality: **cosy, encouraging, playful**.
- **Brand voice:** Reassuring and specific. Examples: “One small kind thing is plenty.” “Your grown-up has tucked away a little surprise.”
- **Wordmark & logo:** An original paper planner corner with one gold star and a small evergreen elf-cap silhouette; no text inside the mark. Use a simple flat site favicon/project logo plus original welcome artwork.
- **Signature brand color:** Evergreen `#174A3B`, balanced by warm paper `#FFF9ED` and brass `#D9A83F`.

## Application architecture and privacy

Use the initialized React + TypeScript + Tailwind frontend and Express/tRPC backend. Preserve Manus OAuth, the typed tRPC client and managed Drizzle/MySQL database; do not invent a Preview user or add a separate email/password provider.

Every family query and mutation derives ownership from the authenticated parent's numeric user ID. A per-parent planner contains 24 editable day rows, a 12-day default length, per-day rewards, a parent-owned reusable reward-template library, and original demo content. Each active day has an editable positive behaviour target; the parent can check it off only while that target is populated. Every state-changing transaction locks the parent planner row first and rechecks its live deletion/countdown length; day-target edits and completions then lock the relevant day row. Settings, deletion and fresh creation use that same parent-first order, so concurrent 24-to-12 changes or delete/recreate actions cannot be bypassed by a stale write. Check-off submits the displayed target so a stale parent screen cannot complete a different target. Updating the target resets only that day's previous completion, preventing a changed behaviour from unlocking a treat early. Each assigned reward is a day-specific snapshot with an optional template link. Applying a saved template copies its current reward label and matching elf image to the selected day; editing the template changes the reusable source but not existing day snapshots, while the parent can reapply it to update a day. The reward editor offers both the scrollable day list and a direct selector for every active day. Parents may switch to 24 days without losing their later entries. All day mutations also enforce `dayNumber <= countdownLength`, so inactive days cannot be changed through direct API calls.

For a shared-device child experience, store only a salted scrypt hash of the six-digit parent PIN. Never serialize that hash to the client. The first signed-in visit must set the PIN; changing it requires an already-unlocked parent session. A successful PIN entry issues a short-lived signed `HttpOnly; Secure; SameSite=None` parent-unlock cookie using the existing project signing key. Parent overview and every management mutation require this additional server-verified unlock. The safe PIN-status operation does not return family reward data. The child-view operation remains protected by Manus OAuth but does not require parent unlock; it selects only child-facing planner fields and active-day content. Day 1's reward is visible when the countdown begins; reward text/image bytes for Day N are included only when Day N-1 is completed. Future locked reward text/image and every template stay out of the child projection. Entering child mode clears the parent-unlock cookie and removes the cached parent overview. Returning to parent mode always presents the PIN gate. No separate child account is introduced.

Validate reward and template images twice: in the browser, accept browser-decodable raster formats (including JPEG/PNG/WebP/AVIF/HEIC/HEIF/GIF where supported), cap input size at 25 MB, resize to 720px and compress to JPEG; on the server, accept only the normalized JPEG payload, fully decode its compressed scan data with a memory bound, enforce 720px dimensions and encoded-size limits, and reject truncated or malformed files before persistence. Keep only small compressed thumbnails in the owning database reward/template row so app-level image deletion removes the bytes. Family deletion removes day/reward/template rows and child-specific settings; retain only the minimal non-content deletion marker and the parent security hash needed to keep a later fresh planner PIN-locked. Clearly tell parents that platform backup retention is separate. Never collect child photos. Disable the starter Vite debug collector in Preview: it must not inject browser code or persist request bodies, API responses, form values, child names, reward labels, or image payloads into diagnostic files. No `.manus-logs` files existed during this change. A deleted planner cannot accept settings changes until the parent explicitly starts a fresh countdown.

Use database transactions for first-time planner seeding, family deletion and fresh-planner reseeding, avoiding partially seeded or half-deleted states. Seed day rows and sample rewards with original content. Keep all identifiers, PIN hashes and hidden reward data out of the child-view projection.

## Serving and routing

Serve one React single-page app and Express API from the existing server/container. tRPC stays under `/api/trpc`; local development uses Vite middleware and production serves the built static client. Use relative same-origin API paths. Keep `client/public/manus-routes.json` synchronized with the only page route `/`. Personalized planner APIs are private; public fingerprinted assets may use normal static caching. Do not create public marketing/store routes or enable publication in this task.

## Project structure

- `client/src/pages/Home.tsx` — page entry that mounts the planner application.
- `client/src/pages/ElfPlanner.tsx` — authenticated parent workspace, child view, story nook, idea drawer, per-day rewards and privacy screens.
- `client/src/pages/ParentPinGate.tsx` — dedicated parent PIN setup/unlock screen.
- `client/src/components/RewardTemplateLibrary.tsx` — parent-only reusable reward/image templates with apply, edit and delete controls.
- `client/src/lib/image.ts` — shared client-side raster decoding, image type/size validation, 720px downscaling and JPEG compression for day rewards and templates.
- `client/src/index.css` — evergreen/paper tokens, responsive calendar and dashboards, reduced-motion rules.
- `client/public/` — route manifest, favicon and static app assets.
- `server/routers.ts` — existing application root plus the planner API.
- `server/plannerRouter.ts` — PIN/unlock gate, input validation, owner-only reward/template mutations and child-safe procedures.
- `server/plannerDb.ts` — transactional seeding, owner-scoped reward/template operations, pin metadata and reward projections.
- `server/plannerSecurity.ts` — PIN hashing, signed parent-unlock tokens, cookie clearing and reward-image byte validation.
- `server/plannerGuard.ts` — shared domain guards for deleted planners and active countdown-day limits.
- `server/plannerGuard.test.ts` — regression tests for deleted-planner settings, active-day bounds, required behaviour targets and reward unlock rules.
- `server/plannerSecurity.test.ts` — focused regression tests for PIN and image validation.
- `drizzle/schema.ts` and `drizzle/` — additive family planner/day/reward/template schema and migrations.
- `app.config.ts` — durable uploaded HTTPS `logoUrl` literal for project branding.

## Delivery boundaries

Type-check, run tests and production build; apply the additive database migration; verify the route manifest and local HTTP readiness; review the parent/child server data boundary and the sequential child reward projection. Do not submit a public publish action. A valid Preview does not mean real parent uploads or an end-to-end OAuth session were manually tested.


## Final-day Santa congratulations audio

The child view may offer a short, generic Santa-style congratulations only after the parent completes the final active day (Day 24 for a 24-day countdown or Day 12 for a 12-day countdown). Keep playback child-initiated with a visible play control and no autoplay. Use one reusable audio asset with no child name or family data in its transcript; reference the stable project-storage path from the client and do not add an audio database field or child-specific upload workflow. Maintain the existing warm, positive, accessible child-view styling.


## Child-view festive chime

Add one short, gentle, generic sleigh-bell chime to the child view as a clearly labelled button. It plays only after a child taps, does not loop or autoplay, and contains no speech or family-specific information. Serve the small static sound asset from the app's same-origin public assets. Keep the existing final-active-day Santa congratulation separate and gated on parent completion.


## Four editable starter rewards for new parents

Use the four original elf scenes already present in the generated reward-template mockup: an elf reading for “Choose tonight's story”, an elf playing a board game for “Pick a family game”, an elf with two mugs for “Cosy hot chocolate together”, and an elf with popcorn for “Choose a festive film”. Reuse these existing illustrations as small cropped JPEG thumbnails instead of generating new artwork. These are generic defaults, never copies of a family's private uploads.

On first creation, insert four independent parent-owned template rows and assign matching image snapshots to the existing sample rewards on Days 2, 5, 9 and 12 in the same database transaction. Preserve the other sample rewards on Days 18 and 24. Existing active planners are not automatically backfilled, edited or reseeded. An explicitly recreated deleted planner receives the same defaults; deleted planners remain deleted until that explicit action. Editing or deleting a template does not change an assigned reward snapshot, and defaults are never reinserted on ordinary reads after a parent edits/deletes them. Use the current managed database and existing template controls; do not change authentication, audio, access settings or publication.

Keep the compact generic image payloads in a server-only seed data module that is included by the existing production bundler, so new-parent setup does not depend on temporary browser URLs, external image hosting or sandbox file paths.


## Optional Netlify-compatible build (no publication)

Keep the existing Manus development/container workflow and all planner business logic. Extract the Express API setup into a shared app factory so the ordinary Node server and a Netlify Function use the exact same health, public-config, OAuth and tRPC routes. The function must not start a network listener or import Vite. Normalize the direct function path and the original `/api/*` path to the same API routing. Preserve response cookies, authentication, parent-PIN gates, owner checks and private/no-store API caching.

Add a Netlify configuration for Node 22, the pinned pnpm toolchain, static output `dist/public`, API rewrites before the SPA fallback, and a bundled TypeScript function. Include its source in TypeScript diagnostics. Retain the small existing same-origin MP3s and server-only JPEG starter payloads. Bundle validated copies of the three generic Manus-hosted decorative elf images at their existing relative paths so Netlify has no dependency on Manus's special storage route.

This is compatibility preparation only. Do not provision a Netlify site, deploy, publish, configure protected keys, replace login, move the managed MySQL database, migrate family uploads, or switch media to Supabase. A real Netlify release still needs supported durable server credentials, verified database access and OAuth callback support for the selected domain; private local tests cannot certify those external prerequisites. Document them without copying current secret values.

Added structure: `server/_core/app.ts` is the shared API factory; `netlify/functions/api.ts` is the serverless adapter; `netlify.toml` declares Netlify build/routing; `server/netlify.test.ts` exercises isolated function requests with mocked database access; `NETLIFY_SETUP.md` explains the remaining manual setup and release checks.


## Parent-initiated family content backup

Add one Download family backup action in the PIN-unlocked Privacy screen. The parent-only tRPC procedure derives ownership from the session; no user/planner identifier is accepted from the browser. A read transaction locks the existing owner planner row using the same parent-first lock as all writers, selects explicit content fields and all stored days/rewards including inactive later days, and paginates the complete template library. It never seeds, inserts, updates or deletes content and refuses missing/deleted planners.

The versioned JSON content includes settings, good-deed progress, reward and template embedded JPEGs, and local template references preserving snapshot links. Exclude account identity, database IDs, PIN hashes, tokens and environment values. Deliver the serialized content in bounded chunks, using a SHA-256 content hash to reject changed snapshots between requests; the browser validates the full hash before offering a dated download. Use the direct tRPC client rather than React Query data caches, keep data only in local download scope, and abort on child mode, logout, parent unlock expiry or unmount. Do not persist export files on the server or public storage.

Show plain-language guidance that this file contains private, unencrypted family content and is a fixed snapshot, not automatic syncing, app source/audio backup or a tested one-click restore. No import endpoint, database migration, Supabase connection or Netlify deployment is added. Test with synthetic fixtures and mocked database boundaries only.
