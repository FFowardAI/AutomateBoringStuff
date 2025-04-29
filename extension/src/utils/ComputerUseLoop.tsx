/// <reference types="chrome"/>
/// <reference lib="dom" />

export type ToolCall =
  | {
      name: "click";
      input: {
        selector?: string;
        coordinates?: { x: number; y: number };
        screenshotDimensions?: { width: number; height: number };
        url?: string;
      };
    }
  | { name: "navigate"; input: { url: string } };

export interface LoopResponse {
  toolCall?: ToolCall;
  message?: string;
  newInstruction?: string;
  screenshotResponse?: boolean; // Indicates if the response was generated using a screenshot
}

// Define the structure of requests to the API
export interface ApiRequest {
  markdown: string;
  screenshot: string; // Data URL of the screenshot
  instruction: string;
}

const API_URL =
  process.env.DEV_API?.concat("/computer_use/function-call") ||
  "http://localhost:8002/api/computer-use/function-call";

let screenshotDimensions: { width: number; height: number } | null = null;

/**
 * Captures a screenshot of the current active tab
 *
 * Uses the Chrome API to capture the visible tab as a PNG.
 * The screenshot is returned as a data URL string that can be:
 * 1. Sent directly to the server for processing
 * 2. Displayed in the UI
 * 3. Converted to a Blob for upload
 *
 * @returns A promise that resolves to the screenshot as a data URL (format: "data:image/png;base64,...")
 * @throws Error if no active tab is found or if screenshot capture fails
 */
async function captureScreenshot(): Promise<{
  screenshot: string;
  width: number;
  height: number;
}> {
  // Find the active tab
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id || tab.windowId === undefined) {
    throw new Error("No active tab or window found");
  }

  // Get the window dimensions
  const win = await chrome.windows.get(tab.windowId);
  if (typeof win.width !== "number" || typeof win.height !== "number") {
    throw new Error("Unable to determine window dimensions");
  }

  // Capture the visible tab as a PNG data URL
  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
  } catch (error) {
    console.error("Error capturing screenshot:", error);
    throw new Error("Failed to capture screenshot");
  }

  screenshotDimensions = { width: win.width, height: win.height };
  return {
    screenshot: dataUrl,
    width: win.width,
    height: win.height,
  };
}
async function executeTool(tabId: number, tool: ToolCall) {
  if (tool.name === "click") {
    const { selector, coordinates } = tool.input;

    console.log("Executing tool:", tool.name, tool.input);
    // coordinate-based click
    if (coordinates && screenshotDimensions) {
      const { x: rawX, y: rawY } = coordinates;
      const { width: shotW, height: shotH } = screenshotDimensions;

      console.log("Executing click at coordinates:", rawX, rawY);

      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: (rawX, rawY, shotW, shotH) => {
          // 1) scale
          const scaleX = window.innerWidth / shotW;
          const scaleY = window.innerHeight / shotH;
          const clientX = rawX * scaleX;
          const clientY = rawY * scaleY;

          // 2) account for scroll
          const viewX = clientX - window.scrollX;
          const viewY = clientY - window.scrollY;

          // 3) find & scroll into view
          const el = document.elementFromPoint(viewX, viewY) as HTMLElement;
          if (!el) return;

          // el.scrollIntoView({ block: "center", inline: "center" });

          // ↓ NEW: create or reuse ghost cursor
          let ghost = document.getElementById(
            "__ghost_cursor__"
          ) as HTMLElement;
          if (!ghost) {
            ghost = document.createElement("div");
            ghost.id = "__ghost_cursor__";
            Object.assign(ghost.style, {
              position: "fixed",
              width: "20px",
              height: "20px",
              background: "rgba(0,0,0,0.4)",
              border: "2px solid white",
              borderRadius: "50%",
              pointerEvents: "none",
              transform: "translate(-50%, -50%)",
              transition: "left 0.1s linear, top 0.1s linear",
              zIndex: "999999",
            });
            document.body.appendChild(ghost);
          }
          // move ghost to target
          ghost.style.left = `${clientX}px`;
          ghost.style.top = `${clientY}px`;

          // dispatch pointer events
          for (const type of ["pointermove", "mousedown", "mouseup"] as const) {
            el.dispatchEvent(
              new MouseEvent(type, {
                clientX,
                clientY,
                bubbles: true,
                cancelable: true,
              })
            );
          }

          // finally click
          el.click();

          // optional: remove ghost after click
          setTimeout(() => {
            ghost.remove();
          }, 500);
        },
        args: [rawX, rawY, shotW, shotH],
      });

      // selector fallback
    } else if (selector) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN", // ← also in MAIN world
        func: (s: string) => {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el) el.click();
          else console.error("Selector not found:", s);
        },
        args: [selector],
      });
    }
  } else if (tool.name === "navigate") {
    await chrome.tabs.update(tabId, { url: tool.input.url });
  }
}

/**
 * Handles automated browser actions based on screenshots and instructions.
 *
 * This module captures screenshots of the browser and sends them to the server,
 * which uses computer vision to analyze the page and determine what actions to take.
 *
 * Implementation:
 * 1. ✅ Takes screenshots of the current tab using Chrome extension APIs
 * 2. ✅ Sends screenshots to the server for visual analysis (no DOM HTML)
 * 3. ✅ Handles click operations using coordinates when available
 * 4. ✅ Supports navigation to URLs
 *
 * The server side handles:
 * - Processing the screenshot
 * - Using computer vision to determine what elements can be interacted with
 * - Returning click coordinates or selectors when click actions are needed
 */
export async function samplingLoop(
  tabId: number,
  initialInstruction: string,
  onIteration?: (resp: LoopResponse) => void,
  maxIterations = 10
): Promise<string> {
  let instruction = initialInstruction;
  let finalMessage = "";

  for (let i = 0; i < maxIterations; i++) {
    try {
      // Capture screenshot
      const { screenshot, width, height } = await captureScreenshot();

      console.log(`Captured screenshot for iteration ${i + 1}`);
      // Create the API request payload
      const requestPayload: ApiRequest = {
        markdown: instruction,
        screenshot,
        instruction: `Screen size: ${width}x${height}.`,
      };
      console.log("Sending API request with screenshot");
      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      if (!resp.ok) {
        throw new Error(`Server error ${resp.status}: ${await resp.text()}`);
      }

      const data: LoopResponse = await resp.json();
      onIteration?.(data);
      console.log(`Received response for iteration ${i + 1}`, data);
      if (data.toolCall) {
        console.log(`Executing tool: ${data.toolCall.name}`);
        await executeTool(tabId, data.toolCall);
        instruction = data.message || instruction;
      } else {
        if (data.message) {
          finalMessage = data.message;
          break;
        }
      }
    } catch (error) {
      console.error(`Error in sampling loop iteration ${i}:`, error);
      if (i === maxIterations - 1) {
        throw error; // Re-throw on last iteration
      }
    }
  }

  return finalMessage;
}
