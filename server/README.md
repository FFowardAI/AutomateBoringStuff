# AutomateBoringStuff Server (Supabase Backend)

This is the server component for the AutomateBoringStuff Chrome extension, using Supabase for data persistence.

## Prerequisites

- [Deno](https://deno.land/) v1.32.0 or higher
- A [Supabase](https://supabase.com/) project

## Install Deno

If you don't have Deno installed, follow these instructions:

### macOS/Linux
```bash
curl -fsSL https://deno.land/install.sh | sh
```

### Windows
```powershell
iwr https://deno.land/install.ps1 -useb | iex
```

### Using package managers:
- **Homebrew (macOS)**: `brew install deno`
- **Chocolatey (Windows)**: `choco install deno`
- **Scoop (Windows)**: `scoop install deno`

After installation, verify Deno is installed correctly:
```bash
deno --version
```

## Setup

1. Clone the repository:
   ```
   git clone https://github.com/58mkt/AutomateBoringStuff.git
   cd AutomateBoringStuff/new_server
   ```

2. Set up your Supabase project:
   - Create a new project on Supabase.
   - Go to the SQL Editor in your Supabase dashboard.
   - Copy the contents of `schema.sql` (or the schema provided in the initial request) and run it to create the necessary tables and relationships.
   - Enable Storage in your Supabase project if you haven't already (for storing images).
   - Create a bucket for images (e.g., `session_images`). Make sure the access policies allow the server (and potentially authenticated users) to upload and read images.

3. Configure environment variables:
   - Copy the `.env.example` file to `.env`:
     ```
     cp .env.example .env
     ```
   - Edit the `.env` file and add your Supabase project URL and anon key:
     - `SUPABASE_URL`: Found in your Supabase project's API settings.
     - `SUPABASE_ANON_KEY`: Found in your Supabase project's API settings (public anon key).
     - `SUPABASE_SERVICE_ROLE_KEY`: (Optional, but recommended for backend operations) Found in your Supabase project's API settings (service_role secret). Using the service role key bypasses Row Level Security (RLS), which might be necessary for certain backend tasks. Ensure RLS is properly configured if you choose to use the anon key for all operations.
   - Set the desired `PORT` (default is 8001).

4. Cache dependencies:
   ```
   deno cache main.ts
   ```

5. Start the server:
   ```
   deno task start
   ```
   Or for development with auto-reloading:
   ```
   deno task dev
   ```

The server will run on the specified port (e.g., `http://localhost:8001`).

## Architecture Overview

(Refer to the architecture diagram provided)

- **Extension**: Captures user actions, screenshots, and context.
- **Backend (this server)**:
    - Receives data from the extension.
    - Stores data in Supabase (users, sessions, recordings, images, scripts, etc.).
    - Interacts with external services (like a VLM for script generation or a compute service for execution - currently placeholders).
    - Manages job statuses and notifications.
    - Serves data back to the extension (e.g., generated scripts, notifications).
- **Supabase**: Handles database storage, authentication (optional, if implemented), and file storage.

## API Endpoints

(These will be added as the implementation progresses)

- `/api/users`: Manage users.
- `/api/sessions`: Manage recording sessions.
- `/api/recordings`: Manage recording segments within sessions.
- `/api/images`: Handle image uploads associated with recordings.
- `/api/scripts`: Manage generated scripts (from VLM).
- `/api/activations`: Handle user requests to activate/run scripts.
- `/api/compute_jobs`: Manage the backend execution jobs for scripts.
- `/api/notifications`: Provide notifications to the user.
- `/api/vlm` (Placeholder): Endpoint to trigger script generation.
- `/api/computer-use` (Placeholder): Endpoint to trigger script execution.

## Security Considerations

- **Supabase Row Level Security (RLS)**: Implement RLS policies on your Supabase tables to ensure users can only access their own data. This is crucial, especially if you use the anon key for client-side operations.
- **Service Role Key**: Keep your `SUPABASE_SERVICE_ROLE_KEY` secure. It bypasses RLS.
- **Input Validation**: Sanitize and validate all data received from the extension before inserting it into the database.
- **Authentication**: Consider adding user authentication (e.g., Supabase Auth) to secure endpoints further.
- **CORS**: Configure CORS appropriately to only allow requests from your extension's origin.

## Troubleshooting

- **Database Errors**: Check the Supabase SQL Editor and logs for errors. Ensure the schema is correctly applied.
- **Connection Issues**: Verify `SUPABASE_URL` and `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in your `.env` file.
- **Permissions**: Ensure Deno has the necessary `--allow-net`, `--allow-read`, `--allow-env` permissions. Check Supabase RLS policies and Storage access rules. 
- **Module Not Found Errors**: If getting "Module not found" errors, run `deno task cache` to update dependencies. 