import React, { useEffect, useState } from "react";
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

// --- Interfaces for Parsed Script ---
interface ScriptMetadata {
  title: string;
  url: string;
  totalSteps: number;
}

interface ScriptStep {
  stepNumber: number;
  action: "Navigate" | "Click" | "Type" | string; // Allow other actions
  target: string;
  value: string | null;
  url?: string; // Optional URL context for the step
  expectedResult?: string; // Optional expected result
}
interface AutomationScript {
  metadata: ScriptMetadata;
  steps: ScriptStep[];
  summary: string;
}

export const AutoActionView: React.FC<AutoActionViewProps> = ({
  markdown,
  onShowAllScripts,
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalMessage, setFinalMessage] = useState<string>("");
  const [parsedScript, setParsedScript] = useState<AutomationScript | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    if (!markdown.trim()) {
      setParsedScript(null);
      setParseError(null);
      return;
    }
    try {
      const obj: AutomationScript = JSON.parse(markdown);
      if (!obj.metadata || !obj.steps || !obj.summary) {
        throw new Error("Missing fields");
      }
      setParsedScript(obj);
      setParseError(null);
    } catch {
      // not a JSON‐script → leave parsedScript null and clear parseError
      setParsedScript(null);
      setParseError(null);
    }
  }, [markdown]);

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    try {
      // always grab the active tab first
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        throw new Error("Cannot run on this page");
      }

      if (parsedScript) {
        // —— NEW SCRIPT FLOW —— 
        // (copy/paste or call into your existing “new logic” here)
        // e.g. fetch(…); executeScript(…); etc, based on parsedScript.steps
        // at end you might clear loading or set some “done” flag
        console.log("Running new JSON‐script flow…");
        // … your code …
        setLoading(false);
        return;
      }

      // —— LEGACY MARKDOWN FLOW —— 
      const result = await samplingLoop(tab.id, markdown, console.log, 10);
      console.log("Legacy automation done:", result);
      setFinalMessage(result);

    } catch (e: any) {
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
        <p style={{ color: "red", marginTop: "0.5rem" }}>Error: {error} {parseError}</p>
      )}
    </div>
  );
};
