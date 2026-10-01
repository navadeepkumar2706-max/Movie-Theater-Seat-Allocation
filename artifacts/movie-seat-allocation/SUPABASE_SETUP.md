# Connect Supabase

The app can run in local demo mode without a Supabase project. Demo changes are saved in this browser only.

To enable staff sign-in and shared database storage:

1. Open the SQL Editor in your Supabase project and run `supabase/setup.sql`.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the app's environment variables. Use the project URL and the public anon/publishable key; never use a service-role key in the browser.
3. Restart the web workflow.
4. Create a staff account from the sign-in screen. Supabase Auth settings control whether email verification is required.

The setup script creates the staff profile trigger, movies, screens, seats, shows, group requests, allocations, access policies, and demo catalogue data. Seat allocation is atomic, and a partial unique index prevents a seat from having two active allocations for the same show.