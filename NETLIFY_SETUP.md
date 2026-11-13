# Netlify setup (not done yet)

The Netlify build and routing files are ready (`netlify.toml`, `netlify/functions/api.ts`).
This older guide described the Manus version, so it was replaced.

When it is time to put the app online:
1. Read `SUPABASE_SETUP.md` first and have the four settings ready.
2. Connect this GitHub repository to a new Netlify site.
3. Add the four settings under Site configuration > Environment variables. Give `DATABASE_URL` and `PARENT_UNLOCK_SECRET` the **Functions** scope.
4. Deploy, then add your live address as the Site URL in Supabase (Authentication > URL Configuration).

Do not use "drag and drop" deploys: that would leave out the protected server code.
