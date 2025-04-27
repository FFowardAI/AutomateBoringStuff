import React, { useState } from "react";

// defines the shape of a single action returned by Claude
type Action =
  | { tool: "click"; selector: string }
  | { tool: "navigate"; url: string };

// Function to check for restricted URLs
function isRestrictedUrl(url?: string): boolean {
  if (!url) return true; // No URL, assume restricted
  return url.startsWith('chrome://') || 
         url.startsWith('chrome-extension://') || 
         url.startsWith('https://chrome.google.com/webstore') ||
         url.startsWith('about:');
}

export const AutoActionView: React.FC = () => {
  const [markdown, setMarkdown] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      // 1. Get the active tab
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      // --- Check for restricted URL --- 
      if (!tab || !tab.id || isRestrictedUrl(tab.url)) {
        throw new Error("Cannot run action on the current page (e.g., chrome:// pages, extension pages, web store).");
      }
      // --- End Check ---

      // 2. Grab the current page DOM.
      console.log("Grabbing DOM from tab:", tab.id);
      const [{ result: domHtml }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });
      if (!domHtml) {
          console.warn("Could not retrieve DOM HTML from the page.");
          // Decide if this is a fatal error or if we can proceed without DOM
          // throw new Error("Failed to get page content.");
      }

      // 3. Make the HTTP request to our local server endpoint for Anthropic.
      console.log("Sending request to backend...");
      const resp = await fetch("https://31ca-4-39-199-2.ngrok-free.app/api/computer-use/function-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'ngrok-skip-browser-warning': 'true', // ngrok warning header
        },
        body: JSON.stringify({
          markdown,
          domHtml: domHtml || "", // Send empty string if DOM fetch failed
          instruction: ``  // add instruction if needed
        }),
      });

      console.log("Claude response status:", resp.status);

      if (!resp.ok) {
        throw new Error(`Server error: ${resp.status} ${await resp.text()}`);
      }
      
      const data = await resp.json();
      
      console.log("Claude response data:", data);

      // 4. Execute the action based on the response
      const toolCall = data?.toolCall // Adjust based on actual response structure
      if (!toolCall || !toolCall.name) {
          throw new Error("Invalid or missing tool call in the response from the server.");
      }

      console.log("Executing Tool call:", toolCall);

      if (toolCall.name === "click") {
        const selector = toolCall.input?.selector; // Adjust based on actual structure
        if (!selector) {
          throw new Error("Missing selector for 'click' action");
        }
        console.log(`Executing click on selector: ${selector}`);
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          func: (sel: string) => {
            try {
              const el = document.querySelector(sel) as HTMLElement | null;
              if (el) { 
                  console.log('Clicking element:', el); 
                  el.click(); 
              } else { 
                  console.error('Element not found for selector:', sel);
              }
            } catch(e) {
                console.error(`Error clicking selector ${sel}:`, e)
            }
          },
          args: [selector],
        });
      } else if (toolCall.name === "navigate") {
        const url = toolCall.input?.url; // Adjust based on actual structure
        if (!url) {
          throw new Error("Missing URL for 'navigate' action");
        }
        console.log(`Navigating to URL: ${url}`);
        await chrome.tabs.update(tab.id!, { url: url });
      } else {
        throw new Error(`Unknown tool action received: ${toolCall.name}`);
      }

      console.log("Action executed successfully.");

    } catch (e: any) {
      console.error("Error in handleStart:", e);
      setError(e.message || "An unknown error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h4>Auto‑Action Runner</h4>
      <textarea
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder="Paste your markdown todo list here…"
        style={{ width: "100%", height: 120 }}
      />
      <button
        className="button button--primary"
        onClick={handleStart}
        disabled={loading || !markdown.trim()}
      >
        {loading ? "Running…" : "Run First Step"}
      </button>
      {error && <p style={{ color: "red" }}>Error: {error}</p>}
    </div>
  );
};