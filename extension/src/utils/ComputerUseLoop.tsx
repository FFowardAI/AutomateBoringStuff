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
  | { name: "navigate"; input: { url: string } }
  | { name: "type"; input: { text: string; submitForm?: boolean } };

export interface LoopResponse {
  toolCall?: ToolCall;
  message?: string;
  newInstruction?: string;
  screenshotResponse?: boolean; // Indicates if the response was generated using a screenshot
  success?: boolean; // Indicates if the step was successfully executed
  completion?: boolean; // Indicates if the step is completed
}

// Define the structure of requests to the API
export interface ApiRequest {
  markdown: string;
  screenshot: string; // Data URL of the screenshot
  instruction: string;
  previousAction?: string; // Information about the previous action taken
  stepContext?: string; // Context about the current step
  successState?: boolean; // Whether the previous step succeeded or failed
  completionIndicator?: boolean; // Indicates if the step appears to be complete
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

/**
 * Executes a tool action in the browser
 */
async function executeTool(tabId: number, tool: ToolCall): Promise<boolean> {
  try {
    if (tool.name === "click") {
      const { selector, coordinates } = tool.input;

      console.log("Executing tool:", tool.name, tool.input);
      // coordinate-based click
      if (coordinates && screenshotDimensions) {
        const { x: rawX, y: rawY } = coordinates;
        const { width: shotW, height: shotH } = screenshotDimensions;

        console.log("Executing click at coordinates:", rawX, rawY);

        const result = await chrome.scripting.executeScript({
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
            if (!el) return false;

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

            return true;
          },
          args: [rawX, rawY, shotW, shotH],
        });

        return result && result[0] && result[0].result === true;

        // selector fallback
      } else if (selector) {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN", // ← also in MAIN world
          func: (s: string) => {
            const el = document.querySelector(s) as HTMLElement | null;
            if (el) {
              el.click();
              return true;
            } else {
              console.error("Selector not found:", s);
              return false;
            }
          },
          args: [selector],
        });

        return result && result[0] && result[0].result === true;
      }

      return false;
    } else if (tool.name === "navigate") {
      await chrome.tabs.update(tabId, { url: tool.input.url });
      return true;
    } else if (tool.name === "type") {
      const { text, submitForm = false } = tool.input;

      try {
        console.log("Executing type tool with text:", text, "submitForm:", submitForm);

        const result = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (textToType: string, shouldSubmit: boolean) => {
            try {
              console.log("Type script executing in page context", { textToType, shouldSubmit });

              // Get the active/focused element
              const activeElement = document.activeElement as HTMLElement;
              console.log("Active element:", activeElement?.tagName, activeElement?.id);

              // If no element is focused or it's not an input field, return false
              if (!activeElement) {
                console.error("No active element found");
                return { success: false, error: "No active element found" };
              }

              if (!(activeElement instanceof HTMLInputElement ||
                activeElement instanceof HTMLTextAreaElement ||
                activeElement.isContentEditable)) {
                console.error("Active element is not an input field:", activeElement.tagName);

                // Try to find a visible input field and focus it
                const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
                console.log("Found potential input elements:", inputs.length);

                let foundVisibleInput = false;
                for (const input of Array.from(inputs)) {
                  const inputElement = input as HTMLInputElement;
                  const rect = inputElement.getBoundingClientRect();

                  // Check if element is visible
                  if (rect.width > 0 && rect.height > 0 &&
                    getComputedStyle(inputElement).display !== 'none' &&
                    getComputedStyle(inputElement).visibility !== 'hidden') {
                    console.log("Found visible input:", inputElement.id || inputElement.name);
                    inputElement.focus();
                    foundVisibleInput = true;
                    break;
                  }
                }

                if (!foundVisibleInput) {
                  return {
                    success: false,
                    error: "No valid input element is focused and couldn't find visible input"
                  };
                }
              }

              // Re-get the active element in case we focused a new one
              const targetElement = document.activeElement as HTMLElement;
              console.log("Target element for typing:", targetElement?.tagName);

              // Type the text into the element
              if (targetElement instanceof HTMLInputElement ||
                targetElement instanceof HTMLTextAreaElement) {
                console.log("Setting value on input/textarea element");
                targetElement.value = textToType;
                // Dispatch input event to trigger any listeners
                targetElement.dispatchEvent(new Event('input', { bubbles: true }));
                targetElement.dispatchEvent(new Event('change', { bubbles: true }));
              } else if (targetElement.isContentEditable) {
                console.log("Setting content on contentEditable element");
                targetElement.textContent = textToType;
                targetElement.dispatchEvent(new InputEvent('input', { bubbles: true }));
              } else {
                console.error("Target element doesn't support input:", targetElement.tagName);
                return {
                  success: false,
                  error: `Element ${targetElement.tagName} doesn't support text input`
                };
              }

              // If submitForm is true, submit the form or press Enter
              if (shouldSubmit) {
                console.log("Attempting to submit form or press Enter");
                // First try to find and submit the form if element is in a form
                const form = targetElement instanceof HTMLInputElement ||
                  targetElement instanceof HTMLTextAreaElement ?
                  targetElement.form : null;

                if (form) {
                  console.log("Found form, submitting directly");
                  form.dispatchEvent(new Event('submit', { bubbles: true }));
                  form.submit();
                } else {
                  console.log("No form found, simulating Enter key press");
                  // Otherwise simulate Enter key press
                  targetElement.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      key: 'Enter',
                      code: 'Enter',
                      keyCode: 13,
                      which: 13,
                      bubbles: true,
                      cancelable: true
                    })
                  );

                  targetElement.dispatchEvent(
                    new KeyboardEvent('keypress', {
                      key: 'Enter',
                      code: 'Enter',
                      keyCode: 13,
                      which: 13,
                      bubbles: true,
                      cancelable: true
                    })
                  );

                  targetElement.dispatchEvent(
                    new KeyboardEvent('keyup', {
                      key: 'Enter',
                      code: 'Enter',
                      keyCode: 13,
                      which: 13,
                      bubbles: true,
                      cancelable: true
                    })
                  );
                }
              }

              return { success: true };
            } catch (error) {
              console.error("Error in type script execution:", error);
              return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
              };
            }
          },
          args: [text, submitForm],
        });

        console.log("Type tool execution result:", result);

        if (result && result[0]) {
          const scriptResult = result[0].result;
          if (scriptResult && typeof scriptResult === 'object' && 'success' in scriptResult) {
            if (!scriptResult.success) {
              console.error("Type tool failed:", scriptResult.error);
            }
            return scriptResult.success === true;
          }
        }

        return false;
      } catch (error) {
        console.error(`Error executing type tool:`, error);
        return false;
      }
    }

    return false;
  } catch (error) {
    console.error(`Error executing tool ${tool.name}:`, error);
    return false;
  }
}

/**
 * Handles automated browser actions based on screenshots and instructions.
 * 
 * This module captures screenshots of the browser and sends them to the server,
 * which uses computer vision to analyze the page and determine what actions to take.
 * 
 * Now supports:
 * 1. ✅ Takes screenshots of the current tab using Chrome extension APIs
 * 2. ✅ Sends screenshots to the server for visual analysis (no DOM HTML)
 * 3. ✅ Handles click operations using coordinates when available
 * 4. ✅ Supports navigation to URLs
 * 5. ✅ Handles text typing in active elements
 * 6. ✅ Tracks success/failure of steps to enable recovery
 * 
 * The server side handles:
 * - Processing the screenshot
 * - Using computer vision to determine what elements can be interacted with
 * - Returning appropriate actions based on the current state
 */
export async function samplingLoop(
  tabId: number,
  initialInstruction: string,
  step: string,
  onIteration?: (resp: LoopResponse) => void,
  maxIterations = 10
): Promise<string> {
  let instruction = initialInstruction;
  let finalMessage = "";
  let previousMousePosition = { x: 0, y: 0 };
  let previousAction = "";
  let successState = true; // Start with assumption of success
  let currentStep = step;
  let completionIndicator = false; // Track if step is completed
  let consecutiveSuccesses = 0; // Track consecutive successful actions

  console.log("Running sampling loop with instruction: ", initialInstruction);

  for (let i = 0; i < maxIterations; i++) {
    try {
      // Wait a bit to ensure page state is stable (especially after navigation)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Capture screenshot
      const { screenshot, width, height } = await captureScreenshot();

      console.log(`Captured screenshot for iteration ${i + 1}`);

      // Create the API request payload with enhanced context
      const requestPayload: ApiRequest = {
        markdown: "This is step " + currentStep +
          (i > 0 ? " previous mouse position: " + previousMousePosition : "") +
          " iteration " + i + " of the automation: " + instruction,
        screenshot,
        instruction: `Screen size: ${width}x${height}.`,
        previousAction: previousAction,
        stepContext: `Step ${currentStep} of the automation: ${instruction}`,
        successState: successState,
        completionIndicator: completionIndicator
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

      // Check if this is a message indicating completion
      if (data.message && !data.toolCall) {
        console.log("Step completion message received:", data.message);
        finalMessage = data.message;

        // Signal completion through the response object
        data.completion = true;
        onIteration?.(data);
        break;
      }

      if (data.toolCall) {
        console.log(`Executing tool: ${data.toolCall.name}`);

        // Record the action we're about to take
        previousAction = `${data.toolCall.name}: ${JSON.stringify(data.toolCall.input)}`;

        // Execute the tool and get success/failure state
        successState = await executeTool(tabId, data.toolCall);

        // Add a delay after executing the tool to let the page react
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Update instruction if provided in response
        instruction = data.message || instruction;

        // Track click coordinates for reference in next iteration
        if (data.toolCall.name === "click" && data.toolCall.input.coordinates) {
          previousMousePosition = data.toolCall.input.coordinates;
        }

        // If action failed, provide this information in the next iteration
        if (!successState) {
          console.warn(`Tool execution failed: ${data.toolCall.name}`);
          consecutiveSuccesses = 0; // Reset consecutive successes counter
        } else {
          // If action was successful, increment counter
          consecutiveSuccesses++;

          // Check if we've had enough consecutive successes to indicate step completion
          if (consecutiveSuccesses >= 2) {
            completionIndicator = true;
          }
        }

        // Add success/failure to the response object for the callback
        data.success = successState;
        onIteration?.(data);
      } else {
        // If no tool call was returned but we have a message, this could be a completion indicator
        if (data.message) {
          finalMessage = data.message;
          break;
        }
      }

      // If we've completed the necessary operations and Claude hasn't given a completion message yet,
      // we can end after a reasonable number of successful steps
      if (completionIndicator && i >= 3) {
        console.log("Step appears complete based on consecutive successful actions");
        if (!finalMessage) {
          finalMessage = "Step completed successfully";
        }
        break;
      }
    } catch (error) {
      console.error(`Error in sampling loop iteration ${i}:`, error);
      successState = false;
      consecutiveSuccesses = 0;
      if (i === maxIterations - 1) {
        throw error; // Re-throw on last iteration
      }
    }
  }

  return finalMessage || "Automation completed";
}
