import React, { useEffect, useState } from "react";
import { samplingLoop, LoopResponse } from "../utils/ComputerUseLoop.tsx";

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

// Track execution of a step
interface StepExecution {
  step: ScriptStep;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
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
  const [currentStepIndex, setCurrentStepIndex] = useState<number>(0);
  const [stepExecutions, setStepExecutions] = useState<StepExecution[]>([]);
  const [currentIteration, setCurrentIteration] = useState<number>(0);

  // Parse the markdown into a script if possible
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

      // Initialize step executions
      const initialStepExecutions = obj.steps.map(step => ({
        step,
        status: 'pending' as 'pending' | 'running' | 'success' | 'failed'
      }));
      setStepExecutions(initialStepExecutions);

    } catch {
      // not a JSON‐script → leave parsedScript null and clear parseError
      setParsedScript(null);
      setParseError(null);
    }
  }, [markdown]);

  // Handle step progress updates
  const handleStepProgress = (response: LoopResponse) => {
    console.log("Step progress:", response);

    // Update the current iteration
    setCurrentIteration(prev => prev + 1);

    // Update the step execution status
    if (stepExecutions.length > currentStepIndex) {
      const updatedExecutions = [...stepExecutions];

      // Update based on tool call success/failure
      if (response.toolCall) {
        updatedExecutions[currentStepIndex].status = 'running';
        if (response.success === false) {
          updatedExecutions[currentStepIndex].message = `Failed to execute ${response.toolCall.name}`;
        }
      } else if (response.message) {
        updatedExecutions[currentStepIndex].status = 'success';
        updatedExecutions[currentStepIndex].message = response.message;
      }

      setStepExecutions(updatedExecutions);
    }
  };

  // Execute a single step of the script
  const executeStep = async (tabId: number, stepIndex: number, retryCount = 0): Promise<string> => {
    if (!parsedScript || stepIndex >= parsedScript.steps.length) {
      return "No more steps to execute";
    }

    const step = parsedScript.steps[stepIndex];

    // Update step status to running
    const updatedExecutions = [...stepExecutions];
    updatedExecutions[stepIndex].status = 'running';
    setStepExecutions(updatedExecutions);

    // Create a step instruction based on the step
    let stepInstruction = '';
    if (step.action === 'Navigate') {
      stepInstruction = `Navigate to ${step.target}`;
    } else if (step.action === 'Click') {
      stepInstruction = `Click on ${step.target}`;
    } else if (step.action === 'Type') {
      stepInstruction = `Type "${step.value}" into ${step.target}`;
    } else {
      stepInstruction = `${step.action} ${step.target} ${step.value ? `with value ${step.value}` : ''}`;
    }

    try {
      // Reset iteration counter for the new step
      setCurrentIteration(0);

      // Add retry information to the instruction if this is a retry
      const fullInstruction = retryCount > 0
        ? `${stepInstruction} (Retry #${retryCount} - previous attempt failed)`
        : stepInstruction;

      // Execute the sampling loop for this step
      const result = await samplingLoop(
        tabId,
        fullInstruction,
        stepIndex.toString(),
        handleStepProgress,
        15 // Increase max iterations to allow for complex steps
      );

      // Update step execution status
      const finalUpdatedExecutions = [...stepExecutions];
      finalUpdatedExecutions[stepIndex].status = 'success';
      finalUpdatedExecutions[stepIndex].message = result;
      setStepExecutions(finalUpdatedExecutions);

      return result;
    } catch (error: any) {
      console.error(`Step ${stepIndex + 1} failed:`, error);

      // Update status to failed
      const failedExecutions = [...stepExecutions];
      failedExecutions[stepIndex].status = 'failed';
      failedExecutions[stepIndex].message = `Error: ${error.message}`;
      setStepExecutions(failedExecutions);

      // Attempt to recover if we haven't retried too many times
      if (retryCount < 2) {
        console.log(`Retrying step ${stepIndex + 1} (attempt ${retryCount + 1})`);
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        return executeStep(tabId, stepIndex, retryCount + 1);
      }

      throw error;
    }
  };

  const handleStart = async () => {
    setError(null);
    setLoading(true);
    setFinalMessage("");

    try {
      // Always grab the active tab first
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || isRestrictedUrl(tab.url)) {
        throw new Error("Cannot run on this page");
      }

      if (parsedScript) {
        let completedSteps = 0;

        // Execute all steps in sequence
        for (let i = 0; i < parsedScript.steps.length; i++) {
          setCurrentStepIndex(i);
          try {
            const result = await executeStep(tab.id, i);
            console.log(`Step ${i + 1} completed:`, result);
            completedSteps++;

            // Add a short delay between steps
            await new Promise(resolve => setTimeout(resolve, 1500));
          } catch (stepError) {
            console.error(`Failed to complete step ${i + 1}`, stepError);
            // Continue with next step even if this one failed
          }
        }

        // Set appropriate final message based on completion
        if (completedSteps === parsedScript.steps.length) {
          setFinalMessage(`Successfully completed all ${parsedScript.steps.length} steps!`);
        } else {
          setFinalMessage(`Completed ${completedSteps} of ${parsedScript.steps.length} steps.`);
        }
      } else {
        // Legacy markdown flow - just pass the whole markdown
        const result = await samplingLoop(tab.id, markdown, "0", console.log, 10);
        console.log("Legacy automation done:", result);
        setFinalMessage(result);
      }

    } catch (e: any) {
      setError(e.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: "1rem" }}>
      <h4>Auto‑Action Runner</h4>

      {/* Script display */}
      {parsedScript ? (
        <div className="script-preview">
          <h5>{parsedScript.metadata.title}</h5>
          <p><small>{parsedScript.summary}</small></p>

          {/* Steps display with status */}
          <div className="script-steps">
            {stepExecutions.map((execution, index) => (
              <div
                key={index}
                className={`script-step ${execution.status === 'running' ? 'step-running' :
                  execution.status === 'success' ? 'step-success' :
                    execution.status === 'failed' ? 'step-failed' : 'step-pending'}`}
              >
                <div className="step-header">
                  <span className="step-number">{index + 1}</span>
                  <span className="step-action">{execution.step.action}</span>
                </div>
                <div className="step-details">
                  <div className="step-target">{execution.step.target}</div>
                  {execution.step.value && (
                    <div className="step-value">{execution.step.value}</div>
                  )}
                  {execution.message && (
                    <div className="step-message">{execution.message}</div>
                  )}
                  {execution.status === 'running' && currentStepIndex === index && (
                    <div className="step-iteration">Iteration: {currentIteration}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <textarea
          value={markdown}
          placeholder="Paste your markdown todo list here…"
          style={{ width: "100%", height: 120 }}
          readOnly
        />
      )}

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
          {loading ? "Running…" : "Run Automation"}
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
          {parsedScript && currentStepIndex < parsedScript.steps.length && (
            <p>
              Step {currentStepIndex + 1} of {parsedScript.steps.length}:
              {parsedScript.steps[currentStepIndex].action} -
              {parsedScript.steps[currentStepIndex].target}
            </p>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: "red", marginTop: "0.5rem" }}>Error: {error} {parseError}</p>
      )}
    </div>
  );
};
