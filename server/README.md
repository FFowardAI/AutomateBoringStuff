# AutomateBoringStuff Server (Supabase Backend)

This is the server component for the AutomateBoringStuff Chrome extension, using Supabase for data persistence and Anthropic's Claude API for intelligent automation.

## Prerequisites

- [Deno](https://deno.land/) v1.32.0 or higher
- A [Supabase](https://supabase.com/) project
- An [Anthropic](https://anthropic.com/) API key (for VLM and Computer Use features)

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
   cd AutomateBoringStuff/server
   ```

2. Set up your Supabase project:
   - Create a new project on Supabase.
   - Go to the SQL Editor in your Supabase dashboard.
   - Copy the contents of `schema.sql` and run it to create the necessary tables and relationships.
   - Enable Storage in your Supabase project if you haven't already (for storing images).
   - Create a bucket for images named `session-images`. Make sure the access policies allow the server (and potentially authenticated users) to upload and read images.

3. Configure environment variables:
   - Copy the `.env.example` file to `.env`:
     ```
     cp .env.example .env
     ```
   - Edit the `.env` file and add your configuration:
     - `SUPABASE_URL`: Found in your Supabase project's API settings.
     - `SUPABASE_ANON_KEY`: Found in your Supabase project's API settings (public anon key).
     - `SUPABASE_SERVICE_ROLE_KEY`: Found in your Supabase project's API settings (service_role secret). Using the service role key bypasses Row Level Security (RLS).
     - `PORT`: Set the desired port (default is 8002).
     - `ANTHROPIC_API_KEY`: Your Anthropic API key for Claude API access (required for VLM and Computer Use features).

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

The server will run on the specified port (e.g., `http://localhost:8002`).

## Architecture Overview

- **Extension**: Captures user actions, screenshots, and context.
- **Backend (this server)**:
    - Receives data from the extension.
    - Stores data in Supabase (users, sessions, recordings, images, scripts, etc.).
    - Integrates with Anthropic's Claude API for:
      - VLM: Analyzing screenshots to generate automation scripts
      - Computer Use: Executing browser automation based on the generated scripts
    - Manages job statuses and notifications.
    - Serves data back to the extension.
- **Supabase**: Handles database storage, authentication (optional, if implemented), and file storage.

## API Endpoints

All endpoints are prefixed with `/api/`:

- `/api/users`: Manage users.
- `/api/sessions`: Manage recording sessions.
- `/api/recordings`: Manage recording segments within sessions.
- `/api/images`: Handle image uploads associated with recordings.
- `/api/scripts`: Manage generated scripts.
- `/api/activations`: Handle user requests to activate/run scripts.
- `/api/compute_jobs`: Manage the backend execution jobs for scripts.
- `/api/notifications`: Provide notifications to the user.
- `/api/vlm`: Process images using Anthropic's Claude to generate automation scripts.
  - `POST /api/vlm/analyze`: Analyze a sequence of images to generate a script.
- `/api/computer-use`: Execute browser automation via Anthropic's Claude.
  - `POST /api/computer-use/function-call`: Determine what browser action to take.
  - `POST /api/computer-use/tool-result`: Process the result of a tool execution.

## VLM Feature

The VLM feature uses Anthropic's Claude API to analyze screenshots and generate automation scripts:

- Takes a sequence of images from a recording session
- Analyzes the UI, interactions, and workflow shown in the images
- Generates a detailed step-by-step script for automating the task
- Saves the generated script to the database

## Computer Use API

The Computer Use API provides browser automation through Anthropic's Claude:

- Supports function calling with Claude to determine browser actions
- Includes tools for:
  - `navigate`: Navigate to a specific URL
  - `click`: Click on DOM elements using CSS selectors
- Processes tool results and determines next steps
- See `routes/computer_use_README.md` for detailed documentation

## Testing

- **Postman Collections**: The repository includes Postman collections for testing:
  - `postman_collection.json`: General API endpoints
  - `computer_use_postman.json`: Computer Use API endpoints
- **cURL Examples**: See `routes/computer_use_curl_examples.sh` for example API calls

## Security Considerations

- **Supabase Row Level Security (RLS)**: Implement RLS policies on your Supabase tables to ensure users can only access their own data.
- **Service Role Key**: Keep your `SUPABASE_SERVICE_ROLE_KEY` secure. It bypasses RLS.
- **API Keys**: Store the Anthropic API key securely and never expose it to clients.
- **Input Validation**: Sanitize and validate all data received from the extension before inserting it into the database.
- **Authentication**: Consider adding user authentication (e.g., Supabase Auth) to secure endpoints further.
- **CORS**: Configure CORS to only allow requests from your extension's origin.

## Troubleshooting

- **Database Errors**: Check the Supabase SQL Editor and logs for errors. Ensure the schema is correctly applied.
- **Connection Issues**: Verify `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` in your `.env` file.
- **API Key Issues**: Ensure your `ANTHROPIC_API_KEY` is valid and properly set in the environment variables.
- **Permissions**: Ensure Deno has the necessary `--allow-net`, `--allow-read`, `--allow-env` permissions. Check Supabase RLS policies and Storage access rules.
- **Module Not Found Errors**: If getting "Module not found" errors, run `deno task cache` to update dependencies.
- **VLM/Computer Use Issues**: Check that your Anthropic API key has access to the required Claude models (currently using claude-3-5-haiku-latest). 