# Project outcomes

## 1. Parent login, PIN unlock, and private family access
- Parents use the existing real Manus login; the app does not simulate Preview users, bypass authentication, or introduce a separate email/password provider.
- A signed-in parent must set a six-digit grown-up PIN before opening parent data or management controls. The PIN is stored only as a salted hash and is never returned in API responses.
- Parent overview data and all parent-management mutations require a server-verified, short-lived unlock; a PIN attempt is rate-limited. Changing the PIN requires an already-unlocked parent session.
- Entering child view clears the parent-unlock cookie and removes the cached parent overview; returning to parent mode requires a PIN again.
- The server's logout mutation clears both the Manus session cookie and the independent parent-unlock cookie.
- Children have no separate accounts. Each planner query and mutation is scoped to the authenticated parent’s own family.

## 2. Countdown setup and adult planner controls
- A parent can set a child display name, choose a 12-day or 24-day countdown, and configure its start date.
- The adult dashboard shows the active countdown and lets the parent edit each active day's elf note, low-prep idea and parent-defined good-behaviour target.
- Each active day has a clear adult-page checkbox to mark its good behaviour complete. It is unavailable until a target is populated; checking it adds one gold star, fills the progress indicator, counts remaining stars down from 12 or 24, and refreshes the child-view gold tracker. Unchecking restores one remaining star. Completion never creates a penalty, streak loss, punishment or ranking.
- Editing a completed day's behaviour target clears that day's completion so the new target must be completed before the following day's reward unlocks.
- Every state-changing operation locks the parent planner row and rechecks its live deletion/countdown length inside the same transaction before touching a day, reward or template; day-target edits and check-offs then lock the relevant day row. Settings changes, deletion and fresh creation use the same parent-first order, so concurrent 24-to-12 changes or delete/recreate actions cannot be bypassed by a stale write.
- The parent check-off submits the exact behaviour target visible on that screen, so a stale request cannot mark a newly changed target complete.
- Server mutations reject a day outside the currently selected 12- or 24-day countdown even when another tab changes settings during the request.
- The parent may add an image to every active day from the reward editor's scrollable list or direct day selector; selecting a different day while its image is still processing or saving is prevented.
- Settings mutations reject a deleted planner marker; the parent must explicitly recreate the countdown before setting child-specific values again.

## 3. Per-day rewards and reusable editable templates
- A parent can add a reward/treat label for each active countdown day and pair it with a private matching elf image.
- The parent can upload a matching picture for every active day. Browser-decodable raster images—including JPEG/PNG/WebP/AVIF/HEIC/HEIF/GIF where supported—are accepted up to 25 MB, resized to 720px and compressed to a small JPEG; the server fully decodes the normalized JPEG scan data within memory/dimension/encoded-size bounds and rejects truncated or malformed files before persistence.
- The parent can save a reward-and-image pair as a private reusable template, apply that template to another day, edit its reward text or elf image, and delete the template. Editing the reusable source does not silently change a day reward already assigned from it; the parent can reapply the edited template to that day.
- The interface labels the upload as a matching elf picture and warns parents to upload planner artwork, never a child's photo.
- Reward and template images are stored in their owning private rows. Removing an image, deleting a reward, or deleting a template removes its image bytes from that active record; deleting a template leaves already-assigned day snapshots intact.

## 4. Child-facing countdown and automatic next-day reveals
- The child-facing countdown shows a personalized heading, friendly day cards, and an original magical helper elf guided by the supplied reference's red winter outfit, pointed ears, snowy firs, golden lights, gifts and warm storybook mood; do not copy its watermark or sign text.
- The parent and child app typography uses the requested Comic Sans family, with sensible comic-style fallbacks where Comic Sans is not installed.
- The parent page has an adult-only checkbox beside the displayed behaviour target; the top gold-star counter reports stars left and stars earned and animates when a good deed is checked off. The child gold-star tracker updates from the same persisted completion state.
- Day 1's assigned reward is available when the countdown begins. Checking off Day N automatically unlocks the assigned reward and matching elf image for Day N+1; there is no separate manual reveal switch.
- When the child visits a completed day, the child view clearly shows the following day's treat name and matching elf image in a "next day's treat" preview. Before the deed is checked off, that following day's reward remains hidden and a gentle unlock hint is shown.
- Its server query projects only child-facing planner fields, active-day content and rewards that are unlocked: Day 1 or a day whose immediately preceding day is complete. It does not return parent IDs, the PIN hash, inactive days, template-library entries, hidden reward text, or hidden reward image bytes.
- Undoing the previous day's completion re-locks the following reward in the server projection.
- Positive progress has no failure state, loss, punishment, ranking or competitive mechanics.

## 5. Family privacy and deletion controls
- The app includes concise privacy guidance and controls to delete planner child-name/settings, day entries, progress, reward labels, reusable templates and uploaded reward/template image data from active app records; deletion also cancels/removes cached child reward projections and template data. A minimal deletion marker and parent security setting are retained so content is not reseeded automatically and a later fresh planner remains PIN-locked.
- A deleted planner cannot be given new child-specific settings until the parent explicitly starts a fresh countdown.
- The deletion text does not claim app controls erase platform database backups.
- Preview does not inject or run the starter debug collector that records browser request bodies, API responses or typed UI values; the collector file is removed and no project `.manus-logs` files remain.
- No public sharing, advertisements, rankings or collection of child photos are added.

## 6. Seeded content, responsive experience, and regression coverage
- A newly created family receives a ready-to-use demo countdown with original sample notes, activities, kind/helpful prompts, original short stories/ideas and editable sample rewards.
- Planner creation, family deletion and fresh-planner reseeding use database transactions so partial content states are not left behind.
- The responsive planner is usable on desktop and mobile, follows the user's supplied warm, cheerful planner reference with original art and interface design, and animates the top remaining-star counter after a parent checks off a good deed.
- Focused regression tests cover salted PIN hashing, reward-image magic-byte validation, deleted-planner/active-day/required-behaviour guards, day-one/previous-day reward-unlock rules, and logout revocation of the parent-unlock cookie.

## 7. Safe delivery boundary
- The app is built and validated in Preview; it is not published publicly unless the user separately requests publication.


## 8. Final-day congratulations audio
- On the final active countdown day—Day 24 in a 24-day plan or Day 12 in a 12-day plan—show a generic Santa congratulations audio control only after the parent has checked off that day.
- Audio plays only after the child taps the control; it never autoplays. The reusable audio contains no child's name or other family-specific data.


## 9. Child-initiated Christmas chime
- The child view includes a clear “Play chime” control for a gentle Christmas bell sound. The sound plays only on tap; it never autoplays or loops and contains no family-specific information.
- The existing generic Santa congratulations remains available only after the parent checks off the final active day—Day 24 of a 24-day countdown or Day 12 of a 12-day countdown—and the child must tap its audio player to hear it.


## 10. Four editable starter rewards and elf pictures for new parents — implemented and tested in Preview
- A new parent's Saved reward templates library starts with “Choose tonight's story”, “Pick a family game”, “Cosy hot chocolate together” and “Choose a festive film”, each paired with its corresponding generic original elf scene from the template mockup.
- Each template is a separate parent-owned copy that the parent can edit, replace, reuse or delete using the existing controls. Edits and deletion never change another family's templates or already-assigned day rewards.
- The four existing sample day rewards on Days 2, 5, 9 and 12 include matching image snapshots; Days 18 and 24 retain their existing sample labels. The current previous-day completion rules still gate the child-visible rewards and pictures.
- First creation and explicit fresh-planner recreation insert defaults transactionally. Existing active planners and private family uploads are untouched. Deleted planners do not automatically reseed, and edited/deleted templates do not reappear on ordinary reads.
- No Supabase/Firebase connection, login change, payment setup or publication is added in this step.


## 11. Optional Netlify-compatible version — prepared and locally tested; not deployed
- The same protected Express OAuth/tRPC API can run through a Netlify Function without starting a resident server or importing Vite; original same-origin `/api/*` calls, cookies, parent-PIN controls and private family ownership remain unchanged.
- Netlify build settings use the pinned package manager, Node 22 and `dist/public`; API rewrites precede the SPA fallback, unknown API routes remain errors, and private API responses are not shared-cached.
- Netlify function source is included in type checking. The existing Manus Preview/server commands and Dockerfile remain supported.
- The three generic decorative elf images are available as validated static copies at their existing relative paths. Existing same-origin chime/Santa MP3s and server-only starter JPEGs remain included, without exposing private family records or adding a Supabase dependency.
- Isolated handler tests cover health/config routes, direct function paths, missing/forged authentication, parent API refusal without a PIN unlock, logout cookies and unknown API paths without accessing or writing the real database.
- A setup guide explains protected server environment variables, supported database/OAuth prerequisites and the remaining external-host release checks. No Netlify site is created or deployed, nothing is published, no protected values are copied, and no family data or authentication is migrated.
- Evidence: TypeScript passed; all 66 tests passed, including 36 isolated Netlify handler tests; production build and compiled-function health smoke test passed; five built static media files match their sources. Supported external database/OAuth configuration, shared durable PIN-attempt limiting and real Netlify deployment/privacy checks remain release prerequisites.


## 12. Missing-reward diagnosis: private planner reference
- Show the authenticated, PIN-unlocked parent's existing planner reference in Rewards & treats, so the user can identify the record being viewed without sharing a PIN, email, child name or image contents.
- This is display-only: do not add database fields, bypass ownership, transfer rewards, reseed records, delete content or change reward-unlock rules.


## 13. Download family backup — implemented and locally tested; no restore or deployment
- A signed-in parent who has unlocked the grown-up PIN can click Download family backup in Privacy to download a dated, versioned JSON file of their own planner settings, all saved day notes/targets/progress, per-day rewards with embedded pictures, and all reusable templates with embedded pictures and local linkage references, including inactive days 13–24.
- Export is read-only and session-owner-scoped; it does not seed or alter records or accept a different family's ID. Missing/deleted planners cannot be exported. No account IDs, email, PIN/hash, tokens or server keys are included.
- Bounded responses work through the existing Netlify adapter; hashes prevent combining chunks from changed snapshots. No backup content is stored in browser query caches or public storage, and mode/logout/unmount/expiry cancels the download.
- The screen explains that the private file is not encrypted, does not update automatically, excludes app code/audio and external bucket files, and has no one-click restore in this change. Show useful download errors and prevent duplicate download requests.
- Verify isolation and full content preservation with synthetic fixtures and mocked database access. Package the updated source with usage/deployment guidance. No Netlify site is deployed, no secrets are collected and no family data is migrated or restored.
- Evidence: TypeScript and production build passed; all 87 tests passed, including owner-scoped database mocks, Netlify authentication, template pagination, multipart integrity and cancellation. Anonymous live-Preview export returns 401 and the updated button module is served. A real parent's disk download and actual Netlify deployment are not claimed as tested.
