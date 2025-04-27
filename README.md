# AutomateBoringStuff

A browser extension that uses AI to observe and automate repetitive tasks in your browser.

## Overview

AutomateBoringStuff is a Chrome extension that records your browser actions, sends them to a server for processing, and generates automation scripts that can replay those actions. It's designed to help you automate repetitive web-based tasks with minimal setup.

## Features

- **Action Recording**: Captures clicks, inputs, form submissions, and navigation events
- **Visual Tracking**: Takes periodic screenshots to understand the visual context of actions
- **AI-Powered Script Generation**: Processes captured actions to create executable automation scripts
- **Script Management**: Save, edit, run, and delete your automation scripts

## Prerequisites

- [Deno](https://deno.land/) v1.32.0 or higher (for the server)
- Chrome browser (v88 or higher)

## Installation

### Extension Setup

1. Clone this repository or download the source code:
   ```
   git clone https://github.com/yourusername/AutomateBoringStuff.git
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" using the toggle in the top-right corner

4. Click "Load unpacked" and select the `AutomateBoringStuff/extension` directory

5. The extension should now be installed and visible in your Chrome toolbar

### Server Setup

The extension requires a local server to process actions and generate scripts.

1. Install Deno by following the instructions at https://deno.land/#installation

2. Navigate to the server directory:
   ```
   cd AutomateBoringStuff/server
   ```

3. Start the server:
   ```
   deno run --allow-net --allow-read --allow-write --allow-env server.js
   ```

By default, the server runs on `http://localhost:8000`. If you need to change this, you can:
1. Set environment variables: `PORT=9000 deno run --allow-net --allow-read --allow-write --allow-env server.js`
2. Update the `SERVER_URL` variable in the extension's `background.js` file to match your server URL

## Usage

1. Click the AutomateBoringStuff icon in your browser toolbar to open the extension popup

2. Click "Start Recording" to begin capturing your actions

3. Perform the sequence of actions you want to automate
   - Browse websites
   - Fill out forms
   - Click buttons
   - Navigate between pages

4. Click "Stop Recording" when you're done

5. Review the generated script and provide a name and description

6. Click "Save Script" to store the automation for future use

7. Run saved scripts from the extension popup by clicking the play button (▶) next to a script

## Connection to Server

The extension communicates with the local server in the following ways:

1. **Screenshot Capture**: Periodically sends screenshots and DOM structure to the server during recording
   - Endpoint: `POST http://localhost:8000/api/screenshot`

2. **Script Generation**: Sends recorded actions to the server for processing
   - Endpoint: `POST http://localhost:8000/api/generateScript`

3. **Script Storage**: Locally stores generated scripts in the browser's storage

## Troubleshooting

- **Extension Not Recording**: Make sure the server is running and check the browser console for errors
- **Server Connection Issues**: Verify that the server URL in `background.js` matches your server configuration
- **Scripts Not Running**: Check if the website you're automating has strict Content Security Policy (CSP) settings
- **Server Won't Start**: Make sure Deno is installed and you've included all the necessary permissions flags

## Development

### Project Structure

- `extension/`: The Chrome extension code
  - `popup/`: UI for the extension popup
  - `utils/`: Utility functions for DOM parsing, action tracking, etc.
  - `background.js`: Background script for managing the extension state
  - `content.js`: Content script injected into web pages
  - `manifest.json`: Extension configuration

- `server/`: The local server for processing actions
  - `server.js`: Main server implementation (Deno)
  - `config.js`: Server configuration
  - `data/`: Data storage directory (created at runtime)

### Customization

- **Server URL**: Change the `SERVER_URL` in `background.js` to connect to a different server
- **Screenshot Interval**: Modify `SCREENSHOT_INTERVAL` in `background.js` to change how often screenshots are taken
- **Script Generation Delay**: Adjust `SCRIPT_GENERATION_DELAY` to change how often intermediate scripts are generated

## License

[MIT License](LICENSE)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 