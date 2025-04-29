/// <reference types="chrome"/>
/// <reference lib="dom" />

export type ToolCall =
  | { name: "click"; input: { selector: string; coordinates?: { x: number; y: number } } }
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
async function captureScreenshot(): Promise<string> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) throw new Error("No active tab found");

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(
      tab.windowId,
      { format: 'png' }
    );
    return dataUrl;
  } catch (error) {
    console.error("Error capturing screenshot:", error);
    throw new Error("Failed to capture screenshot");
  }
}

async function executeTool(tabId: number, tool: ToolCall) {
  if (tool.name === "click") {
    const sel = tool.input.selector;
    const coordinates = tool.input.coordinates;

    if (coordinates) {
      // Use coordinates to click at a specific position
      await chrome.scripting.executeScript({
        target: { tabId },
        func: function (x: number, y: number) {
          // This function runs in the context of the web page where DOM is available
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: x,
            clientY: y
          });
          const element = document.elementFromPoint(x, y);
          if (element) {
            element.dispatchEvent(clickEvent);
          } else {
            console.error("No element found at coordinates:", x, y);
          }
        },
        args: [coordinates.x, coordinates.y],
      });
    } else {
      // Fall back to selector-based clicking
      await chrome.scripting.executeScript({
        target: { tabId },
        func: function (s: string) {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el) el.click();
          else console.error("Selector not found:", s);
        },
        args: [sel],
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
      let screenshot: string;
      try {
        screenshot = await captureScreenshot();
        console.log("Screenshot captured successfully");
      } catch (error) {
        console.error("Failed to capture screenshot:", error);
        throw new Error("Screenshot is required for this operation");
      }

      // Create the API request payload
      const requestPayload: ApiRequest = {
        markdown: instruction,
        screenshot,
        instruction: ""
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
