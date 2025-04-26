# Automate Boring Stuff Chrome Extension

## How to run

1.  **Prerequisites:** Ensure you have [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/installation) installed.
2.  **Install Dependencies:** Navigate to the `extension` directory in your terminal and run:
    ```bash
    pnpm install
    ```
3.  **Build the Extension:** Run the build command:
    ```bash
    pnpm build
    ```
    This will compile the TypeScript code (including the background script and popup UI) and output the necessary files into the `extension/dist` directory.
4.  **Load the Extension in Chrome:**
    *   Open Google Chrome.
    *   Go to `chrome://extensions/`.
    *   Enable "Developer mode" (usually a toggle in the top-right corner).
    *   Click the "Load unpacked" button.
    *   Select the `extension/dist` directory from your project folder.
5.  **Usage:** The extension icon (🚜) should appear in your Chrome toolbar. Click it to open the popup and start recording.


