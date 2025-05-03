/// <reference types="chrome"/>
/// <reference lib="dom" />

// Import ScriptStep interface
export interface ScriptStep {
  stepNumber: number;
  action: string;
  target: string;
  value: string | null;
  url: string;
  expectedResult: string;
}

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
  | { name: "type"; input: { text: string; submitForm?: boolean; selector?: string } };

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
  html?: string; // Add optional HTML content
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

async function getPageHtml(): Promise<string> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  });

  if (results && results[0] && results[0].result) {
    return results[0].result as string;
  } else {
    throw new Error("Failed to get page HTML");
  }
}

/**
 * Executes a tool action in the browser
 */
async function executeTool(tabId: number, tool: ToolCall): Promise<boolean> {
  try {
    if (tool.name === "click") {
      // We will now primarily rely on selectors provided by the LLM
      // based on its HTML analysis.
      const { selector } = tool.input;

      console.log("Executing click tool with selector:", selector);

      if (selector) {
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (s: string) => {
            // Helper function to find elements that might require scrolling
            const findElementWithScrolling = (selector: string, maxScrollAttempts = 5) => {
              return new Promise<HTMLElement | null>(resolve => {
                let el = document.querySelector(selector) as HTMLElement | null;
                if (el && isElementVisible(el)) {
                  // Element is already visible
                  resolve(el);
                  return;
                }

                // Element not found or not visible - try scrolling
                let scrollAttempts = 0;
                const scrollHeight = document.body.scrollHeight;
                const viewportHeight = window.innerHeight;

                // If the element exists but is not visible, scroll directly to it
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  // Wait for scroll to complete
                  setTimeout(() => {
                    // Recheck visibility after scrolling
                    if (isElementVisible(el as HTMLElement)) {
                      resolve(el);
                    } else {
                      console.log("Element found but not visible after scrolling");
                      resolve(el); // Return it anyway and try to interact
                    }
                  }, 800);
                  return;
                }

                // Element not found, start incremental scrolling to look for it
                const scrollStep = () => {
                  if (scrollAttempts >= maxScrollAttempts) {
                    console.log(`Max scroll attempts (${maxScrollAttempts}) reached`);
                    resolve(null);
                    return;
                  }

                  // Scroll down incrementally
                  const scrollPosition = Math.min(
                    document.documentElement.scrollTop + viewportHeight * 0.7,
                    scrollHeight - viewportHeight
                  );

                  window.scrollTo({
                    top: scrollPosition,
                    behavior: 'smooth'
                  });

                  scrollAttempts++;
                  console.log(`Scroll attempt ${scrollAttempts}, position: ${scrollPosition}`);

                  // Wait for scroll and possible content loading
                  setTimeout(() => {
                    // Look for the element again
                    el = document.querySelector(selector) as HTMLElement | null;

                    if (el && isElementVisible(el)) {
                      resolve(el);
                    } else if (document.documentElement.scrollTop + viewportHeight >= scrollHeight - 50) {
                      // We've scrolled to the bottom of the page
                      console.log("Reached end of page");
                      resolve(el); // Return whatever we found, even if not visible
                    } else {
                      // Continue scrolling
                      scrollStep();
                    }
                  }, 800);
                };

                // Start the scrolling process
                scrollStep();
              });
            };

            // Helper to check if element is visible in viewport
            const isElementVisible = (el: HTMLElement) => {
              if (!el) return false;

              const rect = el.getBoundingClientRect();
              const windowHeight = window.innerHeight || document.documentElement.clientHeight;
              const windowWidth = window.innerWidth || document.documentElement.clientWidth;

              // Check if element is within viewport bounds
              const vertInView = rect.top < windowHeight && rect.bottom > 0;
              const horInView = rect.left < windowWidth && rect.right > 0;

              return vertInView && horInView;
            };

            // Main execution function
            return (async () => {
              console.log("Looking for element with selector:", s);
              const el = await findElementWithScrolling(s);

              if (!el) {
                console.error("Element not found after scrolling attempts:", s);
                return false;
              }

              // Ensure the element is in view
              el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

              // Create a visual highlight to show where we're clicking
              const highlight = document.createElement('div');
              highlight.style.position = 'absolute';
              const rect = el.getBoundingClientRect();
              highlight.style.left = `${window.scrollX + rect.left}px`;
              highlight.style.top = `${window.scrollY + rect.top}px`;
              highlight.style.width = `${rect.width}px`;
              highlight.style.height = `${rect.height}px`;
              highlight.style.border = '2px solid #FF5722';
              highlight.style.backgroundColor = 'rgba(255, 87, 34, 0.2)';
              highlight.style.borderRadius = '3px';
              highlight.style.zIndex = '10000';
              highlight.style.pointerEvents = 'none';
              document.body.appendChild(highlight);

              // Wait for scroll and highlights to settle
              await new Promise(resolve => setTimeout(resolve, 800));

              // Perform the interaction
              console.log("Clicking on element:", s);
              el.focus();
              el.click();

              // Clean up
              setTimeout(() => {
                highlight.remove();
              }, 500);

              return true;
            })();
          },
          args: [selector],
        });

        // For the click tool specifically, we should add a short delay after execution
        // to allow any page changes to take effect
        await new Promise(resolve => setTimeout(resolve, 1500));

        return result && result[0] && result[0].result === true;
      } else {
        console.error("Click tool called without a selector.");
        return false; // Click requires a selector now
      }
    } else if (tool.name === "navigate") {
      await chrome.tabs.update(tabId, { url: tool.input.url });
      return true;
    } else if (tool.name === "type") {
      const { text, submitForm = false, selector = null } = tool.input;

      try {
        console.log("Executing type tool with text:", text, "submitForm:", submitForm, "selector:", selector);

        const result = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: (textToType: string, shouldSubmit: boolean, elementSelector: string | null) => {
            // Helper to find elements with scrolling - similar to click handler
            const findElementWithScrolling = (selector: string, maxScrollAttempts = 5) => {
              return new Promise<HTMLElement | null>(resolve => {
                let el = document.querySelector(selector) as HTMLElement | null;
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  // Wait for scroll to complete
                  setTimeout(() => {
                    resolve(el);
                  }, 800);
                  return;
                }

                // Element not found, start incremental scrolling
                let scrollAttempts = 0;
                const scrollHeight = document.body.scrollHeight;
                const viewportHeight = window.innerHeight;

                const scrollStep = () => {
                  if (scrollAttempts >= maxScrollAttempts) {
                    resolve(null);
                    return;
                  }

                  // Scroll down incrementally
                  const scrollPosition = Math.min(
                    document.documentElement.scrollTop + viewportHeight * 0.7,
                    scrollHeight - viewportHeight
                  );

                  window.scrollTo({
                    top: scrollPosition,
                    behavior: 'smooth'
                  });

                  scrollAttempts++;

                  // Wait for scroll and content loading
                  setTimeout(() => {
                    // Try finding the element again
                    el = document.querySelector(selector) as HTMLElement | null;

                    if (el) {
                      resolve(el);
                    } else if (document.documentElement.scrollTop + viewportHeight >= scrollHeight - 50) {
                      resolve(null);
                    } else {
                      scrollStep();
                    }
                  }, 800);
                };

                scrollStep();
              });
            };

            // Main execution
            return (async () => {
              try {
                let activeElement = document.activeElement as HTMLElement;

                // If selector provided, find and focus that element
                if (elementSelector) {
                  console.log("Looking for element to type in with selector:", elementSelector);
                  const el = await findElementWithScrolling(elementSelector);

                  if (el) {
                    console.log("Found element by selector:", elementSelector);
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    el.focus();
                    activeElement = el;
                  } else {
                    console.error("Element not found with selector:", elementSelector);
                  }
                }

                // Rest of type implementation as before
                // ... continue with existing typing logic ...

                if (!activeElement) {
                  activeElement = document.activeElement as HTMLElement;
                }

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
                      inputElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      await new Promise(resolve => setTimeout(resolve, 500));
                      inputElement.focus();
                      foundVisibleInput = true;
                      activeElement = inputElement;
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
                const targetElement = activeElement;
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
            })();
          },
          args: [text, submitForm, selector],
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
 * Enhanced response from the sampling loop with more detailed information
 */
export interface EnhancedLoopResponse extends LoopResponse {
  htmlContent?: string; // HTML content of the page
  stepNumber: number; // Step number in the workflow
  detailedError?: string; // Detailed error information if a step failed
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
      // Fetch page HTML
      const pageHtml = await getPageHtml();

      console.log(`Captured screenshot and HTML for iteration ${i + 1}`);

      // Create the API request payload with enhanced context
      const requestPayload: ApiRequest = {
        markdown: "This is step " + currentStep +
          " iteration " + i + " of the automation: " + instruction,
        screenshot,
        instruction: `Screen size: ${width}x${height}.`,
        previousAction: previousAction,
        stepContext: `Step ${currentStep} of the automation: ${instruction}`,
        successState: successState,
        completionIndicator: completionIndicator,
        html: pageHtml // Include HTML content
      };

      console.log("Sending API request with screenshot and HTML");

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

/**
 * Enhanced version of the sampling loop that returns more detailed success/failure information
 * for use with the adaptive workflow manager
 */
export async function enhancedSamplingLoop(
  tabId: number,
  step: ScriptStep,
  stepNumber: number,
  onIteration?: (resp: EnhancedLoopResponse) => void,
  maxIterations = 10
): Promise<EnhancedLoopResponse> {
  let instruction = JSON.stringify(step);
  let finalMessage = "";
  let previousAction = "";
  let successState = true; // Start with assumption of success
  let completionIndicator = false; // Track if step is completed
  let consecutiveSuccesses = 0; // Track consecutive successful actions
  let htmlContent = ""; // Store the latest HTML content
  let detailedError: string | undefined;

  console.log(`Running enhanced sampling loop for step ${stepNumber}:`, step);

  for (let i = 0; i < maxIterations; i++) {
    try {
      // Wait a bit to ensure page state is stable (especially after navigation)
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Capture screenshot
      const { screenshot, width, height } = await captureScreenshot();
      // Fetch page HTML
      const pageHtml = await getPageHtml();
      htmlContent = pageHtml; // Store for return value

      console.log(`Captured screenshot and HTML for iteration ${i + 1}`);

      // Create the API request payload with enhanced context
      const requestPayload: ApiRequest = {
        markdown: `Executing step ${stepNumber} of the automation: ${instruction}`,
        screenshot,
        instruction: `Screen size: ${width}x${height}.`,
        previousAction: previousAction,
        stepContext: `Step ${stepNumber}: ${step.action} on "${step.target}" with expected result: "${step.expectedResult}"`,
        successState: successState,
        completionIndicator: completionIndicator,
        html: pageHtml // Include HTML content
      };

      console.log("Sending API request with screenshot and HTML");

      const resp = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestPayload),
      });

      if (!resp.ok) {
        const errorText = await resp.text();
        detailedError = `Server error ${resp.status}: ${errorText}`;
        throw new Error(detailedError);
      }

      const data: LoopResponse = await resp.json();

      // Enhance the response with additional details
      const enhancedResponse: EnhancedLoopResponse = {
        ...data,
        stepNumber,
        htmlContent,
        detailedError
      };

      onIteration?.(enhancedResponse);
      console.log(`Received response for iteration ${i + 1}`, data);

      // Check if this is a message indicating completion
      if (data.message && !data.toolCall) {
        console.log("Step completion message received:", data.message);
        finalMessage = data.message;

        // Signal completion through the response object
        enhancedResponse.completion = true;
        onIteration?.(enhancedResponse);
        return enhancedResponse;
      }

      if (data.toolCall) {
        console.log(`Executing tool: ${data.toolCall.name}`);

        // Record the action we're about to take
        previousAction = `${data.toolCall.name}: ${JSON.stringify(data.toolCall.input)}`;

        // Execute the tool and get success/failure state
        successState = await executeTool(tabId, data.toolCall);

        // Add a delay after executing the tool to let the page react
        await new Promise(resolve => setTimeout(resolve, 1000));

        // If action failed, provide this information in the next iteration
        if (!successState) {
          console.warn(`Tool execution failed: ${data.toolCall.name}`);
          detailedError = `Failed to execute ${data.toolCall.name} on ${JSON.stringify(data.toolCall.input)}`;
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
        enhancedResponse.success = successState;
        enhancedResponse.detailedError = detailedError;
        onIteration?.(enhancedResponse);
      } else {
        // If no tool call was returned but we have a message, this could be a completion indicator
        if (data.message) {
          finalMessage = data.message;
          enhancedResponse.completion = true;
          onIteration?.(enhancedResponse);
          return enhancedResponse;
        }
      }

      // If we've completed the necessary operations and Gemini hasn't given a completion message yet,
      // we can end after a reasonable number of successful steps
      if (completionIndicator && i >= 3) {
        console.log("Step appears complete based on consecutive successful actions");
        if (!finalMessage) {
          finalMessage = "Step completed successfully";
        }
        enhancedResponse.completion = true;
        enhancedResponse.message = finalMessage;
        onIteration?.(enhancedResponse);
        return enhancedResponse;
      }
    } catch (error) {
      console.error(`Error in sampling loop iteration ${i}:`, error);
      successState = false;
      consecutiveSuccesses = 0;

      if (error instanceof Error) {
        detailedError = error.message;
      } else {
        detailedError = String(error);
      }

      if (i === maxIterations - 1) {
        return {
          stepNumber,
          message: finalMessage || `Automation step ${stepNumber} failed: ${detailedError}`,
          success: false,
          completion: false,
          htmlContent,
          detailedError
        };
      }
    }
  }

  return {
    stepNumber,
    message: finalMessage || "Automation completed",
    success: successState,
    completion: true,
    htmlContent,
    detailedError
  };
}