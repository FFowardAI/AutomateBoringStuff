export type ToolCall =
  | { name: "click"; input: { selector: string } }
  | { name: "navigate"; input: { url: string } };

export interface LoopResponse {
  toolCall?: ToolCall;
  message?: string;
  newInstruction?: string;
}

const API_URL =
  process.env.DEV_API?.concat("/computer_use/function-call") ||
  "http://localhost:8002/api/computer-use/function-call";

async function fetchDomContent(): Promise<string> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (!tab?.id) throw new Error("No active tab found");
  const result = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.outerHTML,
  });
  return result[0].result as string;
}

async function executeTool(tabId: number, tool: ToolCall) {
  if (tool.name === "click") {
    const sel = tool.input.selector;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (s: string) => {
        const el = document.querySelector(s) as HTMLElement | null;
        if (el) el.click();
        else console.error("Selector not found:", s);
      },
      args: [sel],
    });
  } else if (tool.name === "navigate") {
    await chrome.tabs.update(tabId, { url: tool.input.url });
  }
}

/**
 * TODO: We need to send screenshots to the server for the function call.
 * The response should contain the coordinates of the element to click, if we will click.
 * 
 * 
 * Step by step of changes needed to achieve this:
 * 1. Add a new function to take a screenshot of the current tab and send it to the server.
 * 2. Modify the server to accept the screenshot and return the coordinates of the element to click when calling "click".
 * 3. Modify the `executeTool` function to use the coordinates returned by the server to click on the element.
 * 4. Modify the `samplingLoop` function to send the screenshot and instructions to the server instead of the DOM HTML.
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
    const domHtml = await fetchDomContent();

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown: instruction, domHtml, instruction: "" }),
    });

    if (!resp.ok) {
      throw new Error(`Server error ${resp.status}: ${await resp.text()}`);
    }

    const data: LoopResponse = await resp.json();
    onIteration?.(data);

    if (data.toolCall) {
      await executeTool(tabId, data.toolCall);
      instruction = data.message || instruction;
    } else {
      if (data.message) {
        finalMessage = data.message;
        break;
      }
    }
  }

  return finalMessage;
}
