# Download your family backup

## Use the new button

1. Open **Preview** in the Manus task where this updated app was prepared. Refresh it once.
2. Sign in with the same parent account you used for your planner.
3. Enter your six-digit grown-up PIN.
4. Open **Privacy** in the grown-up navigation.
5. Click **Download family backup**. Wait while it says **Preparing backup…**.
6. Check your browser's **Downloads** folder for a file named `my-elf-countdown-family-backup-…json`. If the browser asks where to save it, choose a private folder.
7. Check that the downloaded file exists and is not empty. Keep another copy in a private cloud folder or on an encrypted drive.

If you do not see the button, confirm you are viewing this task's updated Preview, not an older published release or a previously deployed Netlify site. Updating the source/Preview does not automatically update another host.

## What the file contains

The JSON file contains your planner's display name, countdown length and start date; saved day notes, activities, behaviour targets and completion; per-day reward text and embedded reward pictures; and reusable reward templates with embedded pictures. It includes saved days outside the currently selected countdown length, so a 12-day view does not drop later saved content. Template references in the file are local references, not your database or account identifiers.

Pictures are embedded as data URLs, so the file does not depend on temporary image links. It keeps the small compressed pictures saved by the app; it is not a backup of the original full-resolution upload before compression.

Only the signed-in, PIN-unlocked parent's own planner can be exported. There is no field for choosing another parent's planner. Downloading does not reset, reseed, edit or delete your stored content.

## Keep the file private

**The file is not encrypted.** It contains your family's planner content and rewards that may still be hidden in child view. Do not send it to clients, place it in a public folder, upload it to GitHub/Netlify, or leave it accessible on a device the child uses. The export contains no PIN/hash, account identity, login tokens or server credentials, but its family content is still private.

A backup is a fixed snapshot, not automatic syncing. Download a fresh copy after important edits or additions and keep the older copies too. If the planner changes while the chunks are downloading, the app refuses to combine different versions and asks you to start again. Avoid editing in another tab during the download. Switching to child view, signing out, expiry of parent mode or closing the app cancels an in-progress download.

## What it does not contain

This family file is not an app deployment or whole database backup. It excludes app source code, generic decorative artwork/audio assets, Supabase bucket files, other parents' data, database schema and platform configuration. The separate updated source ZIP contains bundled generic art/audio and app code, but no live family database contents or credentials. Keep both kinds of backup.

**There is no one-click restore button in this update.** The versioned content export has been designed for a future validated import or controlled recovery, but a restore workflow must be implemented and tested before promising that a downloaded file can be re-imported safely. Never test recovery by deleting your working planner.

## Download errors

If your browser does not save the file, check its download notifications/settings and try again. A download-started message means the app asked the browser to save; it cannot confirm that the file reached your chosen disk or cloud folder.

If the app reports that the planner changed, wait for edits/saves in other tabs to finish, then download a fresh copy. If parent access expired, unlock with your PIN again and retry. A missing/deleted planner is not recreated by the backup request.

If a problem remains, report the error message only. Do not paste the private backup contents or your PIN into chat.
