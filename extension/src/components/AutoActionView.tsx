import React, { useState } from "react";
import { samplingLoop } from "../utils";

interface AutoActionViewProps {
  markdown: string;
  onShowAllScripts?: () => void;
}

// Function to check for restricted URLs
function isRestrictedUrl(url?: string): boolean {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("about:")
  );
}

export const AutoActionView: React.FC<AutoActionViewProps> = ({
  markdown,
  onShowAllScripts,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalMessage, setFinalMessage] = useState<string>("");

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        throw new Error(
          "Cannot run action on the current page (e.g., chrome:// pages, extension pages, web store)."
        );
      }

      const result = await samplingLoop(
        tab.id,
        markdown,
        (resp) => {
          console.log("Iteration response:", resp);
        },
        10
      );
      console.log("Automation finished, message:", result);
      setFinalMessage(result);
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
        placeholder="Paste your markdown todo list here…"
        style={{ width: "100%", height: 120 }}
        readOnly
      />
      {finalMessage && (
        <div
          style={{ margin: "1rem 0", padding: "0.5rem", background: "#eef" }}
        >
          <strong>Done:</strong> {finalMessage}
        </div>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: "1rem",
        }}
      >
        <button
          className="button button--primary"
          onClick={handleStart}
          disabled={loading || !markdown.trim()}
        >
          {loading ? "Running…" : "Run First Step"}
        </button>
        {onShowAllScripts && (
          <button
            className="button button--secondary"
            onClick={onShowAllScripts}
            disabled={loading}
          >
            Show All Scripts
          </button>
        )}
      </div>
      {loading && (
        <div
          style={{
            marginTop: "1rem",
            padding: "0.5rem",
            backgroundColor: "#f8f9fa",
            borderRadius: "4px",
            textAlign: "center",
          }}
        >
          <p>Processing page content and executing automation...</p>
        </div>
      )}
      {error && (
        <p style={{ color: "red", marginTop: "0.5rem" }}>Error: {error}</p>
      )}
    </div>
  );
};
