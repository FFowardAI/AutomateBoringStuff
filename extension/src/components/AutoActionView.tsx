import React, { useState } from "react";

// defines the shape of a single action returned by Claude
type Action =
  | { tool: "click"; selector: string }
  | { tool: "navigate"; url: string };

export const AutoActionView: React.FC = () => {
  const [markdown, setMarkdown] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      // 1. Grab the current page DOM.
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab.id) throw new Error("No active tab");

      const [{ result: domHtml }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => document.documentElement.outerHTML,
      });

      // 2. Make the HTTP request to our local server endpoint for Anthropic.
      const resp = await fetch("https://31ca-4-39-199-2.ngrok-free.app/api/computer-use/function-call", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'ngrok-skip-browser-warning': 'true', // ngrok warning header
        },
        body: JSON.stringify({
          markdown,
          domHtml: "dom",
          instruction: ``  // add instruction if needed
        }),
      });

      console.log("Claude response:", resp);

      if (!resp.ok) {
        throw new Error(`Server error: ${resp.status} ${await resp.text()}`);
      }
      
      const data = await resp.json();
      
      console.log("Claude response:", data);
      const toolCall = data?.toolCal

      console.log("Tool call:", toolCall);

      if (toolCall.name === "click") {
        if (!toolCall.selector) {
          throw new Error("Missing selector for 'click' action");
        }
        await chrome.scripting.executeScript({
          target: { tabId: tab.id! },
          func: (sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (el) el.click();
          },
          args: [toolCall.selector],
        });
      } else if (toolCall.name === "navigate") {
        if (!toolCall.input.url) {
          throw new Error("Missing URL for 'navigate' action");
        }
        await chrome.tabs.update(tab.id!, { url: toolCall.input.url });
      } else {
        throw new Error(`Unknown tool action: ${toolCall.name}`);
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message || "Unknown error");
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