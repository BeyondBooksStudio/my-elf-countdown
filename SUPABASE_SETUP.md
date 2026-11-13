# My Elf Countdown: Supabase login and database

Parents now **sign up and log in with email and password** through Supabase Auth,
and the planner is saved in your Supabase project ("Elf Countdown").
The old "Sign in with Manus" login and the Manus MySQL database are no longer used.

## The four settings the app needs

| Name | Secret? | Where to find it |
|---|---|---|
| `SUPABASE_URL` | No | Already filled in `.env.example` |
| `SUPABASE_PUBLISHABLE_KEY` | No | Already filled in `.env.example` |
| `DATABASE_URL` | **YES** | Supabase > **Connect** > **Transaction pooler** > copy the string, replace `[YOUR-PASSWORD]` with your database password (Project Settings > Database > Reset password if you've forgotten it) |
| `PARENT_UNLOCK_SECRET` | **YES** | Make up 40+ random letters and numbers. Keep it private. |

Put the secret ones only in Netlify's Environment variables (or a local `.env` file).
Never paste them into chat, GitHub or screenshots.

## How it fits together

- The browser logs in with Supabase and receives a login token.
- Every request to the app's server carries that token. The server checks it with Supabase and uses the Supabase user ID as the owner of the planner.
- The grown-up PIN, child view and reward-unlock rules are unchanged and still enforced on the server.
- Your database tables already existed; **no database changes were needed.**

## Before real families use it

- In Supabase > Authentication > Sign In / Providers, switch **Confirm email** ON.
- In Authentication > URL Configuration, set the **Site URL** to your live address.
- Not built yet: "Forgot password". Ask Claude to add it.
- The `user_settings` table is not used by this app. It stores a PIN as plain text, so don't put real PINs in it.

## For developers

- `pnpm install`, `pnpm check` (types), `pnpm test` (83 tests), `pnpm dev` (needs a `.env`).
- Auth: `server/_core/supabaseAuth.ts`. Database: `server/db.ts`, `server/plannerDb.ts`, `drizzle/schema.ts` (describes the existing tables; do not run migrations from it).
