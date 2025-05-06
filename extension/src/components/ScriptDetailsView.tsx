import React, { useState, useEffect, useRef } from 'react';
import { samplingLoop, enhancedSamplingLoop, EnhancedLoopResponse, ScriptStep } from "../utils/ComputerUseLoop.tsx";
import { ShareIcon } from './icons/ShareIcon.tsx'; // Import the icon

interface ScriptMetadata {
    title: string;
    url: string;
    totalSteps: number;
}

interface ParsedScript {
    id?: number;
    metadata: ScriptMetadata;
    steps: ScriptStep[];
    summary: string;
}

interface ScriptDetailsViewProps {
    script: ParsedScript;
    onBack: () => void;
    // Add handlers for future functionality
    // onSave?: (updatedScript: ParsedScript) => void; 
    onRun?: (script: ParsedScript, context?: string) => void;
}

// Define types for ExecutionState
interface ExecutionState {
    currentStepIndex: number;
    isRunning: boolean;
    status: "idle" | "running" | "completed" | "failed";
    stepsStatus: { [key: number]: "pending" | "running" | "success" | "failed" };
    logs: LogEntry[];
    lastError?: string;
}

interface LogEntry {
    type: "info" | "success" | "error";
    message: string;
    timestamp: Date;
}

export const ScriptDetailsView: React.FC<ScriptDetailsViewProps> = ({ script, onBack, onRun }) => {
    // Local state for edits and context
    const [editableScript, setEditableScript] = useState<ParsedScript>(script);
    const [isEditing, setIsEditing] = useState(false);
    const [contextPrompt, setContextPrompt] = useState('');
    const [finalMessage, setFinalMessage] = useState<string>("");
    const [isShareCopied, setIsShareCopied] = useState(false); // State for share copy feedback

    // New state for dynamic execution
    const [executionState, setExecutionState] = useState<ExecutionState>({
        currentStepIndex: 0,
        isRunning: false,
        status: "idle",
        stepsStatus: {},
        logs: [],
        lastError: undefined
    });

    // Create a ref to track if the component is mounted
    const isMounted = useRef(true);

    // Add refs for scrolling to active steps
    const stepsListRef = useRef<HTMLDivElement>(null);
    const stepRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});

    // Effect for auto-scrolling to the active step
    useEffect(() => {
        const currentStepNumber = executionState.currentStepIndex >= 0 &&
            executionState.currentStepIndex < editableScript.steps.length ?
            editableScript.steps[executionState.currentStepIndex]?.stepNumber : null;

        if (currentStepNumber && stepRefs.current[currentStepNumber]) {
            stepRefs.current[currentStepNumber]?.scrollIntoView({
                behavior: 'smooth',
                block: 'center'
            });
        }
    }, [executionState.currentStepIndex, executionState.isRunning]);

    // Initialize step status
    useEffect(() => {
        const initialStepsStatus: { [key: number]: "pending" | "running" | "success" | "failed" } = {};
        script.steps.forEach(step => {
            initialStepsStatus[step.stepNumber] = "pending";
        });

        setExecutionState(prev => ({
            ...prev,
            stepsStatus: initialStepsStatus
        }));

        // Cleanup function
        return () => {
            isMounted.current = false;
        };
    }, [script]);

    // Add logger functions
    const addLog = (type: "info" | "success" | "error", message: string) => {
        if (!isMounted.current) return;

        setExecutionState(prev => ({
            ...prev,
            logs: [...prev.logs, { type, message, timestamp: new Date() }]
        }));
    };

    // Get the base URL for API calls
    const getApiBaseUrl = () => {
        // For development
        if (process.env.DEV_API) {
            return process.env.DEV_API;
        }
        // For production, try to use the server URL from extension settings
        // or fall back to default localhost URL
        return "https://e77e-192-54-222-210.ngrok-free.app";
    };

    // Handler for local edits (for now, just toggles edit mode)
    const handleEditToggle = () => {
        setIsEditing(!isEditing);
        if (!isEditing) {
            // Reset local state to original script if cancelling edit
            setEditableScript(script);
        }
        // In a real implementation, you might save changes here or
        // provide a dedicated save button only visible in edit mode.
    };

    // Handler for persistent edits (placeholder)
    const handleSaveToDB = () => {
        console.log("Saving to DB (not implemented):", editableScript);
        // Call onSave prop when implemented
        setIsEditing(false); // Exit edit mode after saving
    };

    const handleShareClick = () => {
        if (!editableScript.id) return;
        const shareUrl = `#script-${editableScript.id}`; // Placeholder URL
        navigator.clipboard.writeText(shareUrl).then(() => {
            console.log(`Copied link for script ${editableScript.id}: ${shareUrl}`);
            setIsShareCopied(true);
            setTimeout(() => setIsShareCopied(false), 1500); // Reset after 1.5s
        }).catch(err => {
            console.error('Failed to copy script link: ', err);
            // Optionally show an error message to the user
        });
    };

    // New function to execute script steps dynamically without recovery
    const executeScriptSteps = async (tabId: number, script: ParsedScript, activeTab: chrome.tabs.Tab) => {
        const steps = [...script.steps]; // Make a copy of the steps array
        let currentStepIndex = 0;

        // Track which original steps have been completed successfully
        const completedOriginalSteps = new Set<number>();

        while (currentStepIndex < steps.length && isMounted.current) {
            const step = steps[currentStepIndex];

            try {
                // Update status to running for current step
                setExecutionState(prev => ({
                    ...prev,
                    currentStepIndex,
                    stepsStatus: {
                        ...prev.stepsStatus,
                        [step.stepNumber]: "running"
                    }
                }));

                addLog("info", `Executing step ${step.stepNumber}: ${step.action} on "${step.target}"`);

                // Execute step
                const result = await enhancedSamplingLoop(
                    tabId,
                    step,
                    step.stepNumber,
                    (iterResult) => {
                        console.log("Step iteration result:", iterResult);

                        // If we get a completion indicator during iterations, mark as potentially successful
                        if (iterResult.completion) {
                            completedOriginalSteps.add(step.stepNumber);
                            setExecutionState(prev => ({
                                ...prev,
                                stepsStatus: {
                                    ...prev.stepsStatus,
                                    [step.stepNumber]: "success"
                                }
                            }));
                        }
                    },
                    10 // Max iterations
                );

                // Enhanced success detection - check both explicit success flag AND the expected result
                const isStepSuccessful = result.success ||
                    result.completion ||
                    // Check if result message contains expected result or similar text
                    (result.message &&
                        (result.message.toLowerCase().includes('success') ||
                            result.message.toLowerCase().includes('loaded successfully') ||
                            result.message.toLowerCase().includes(step.expectedResult.toLowerCase().substring(0, 10))));

                // Check if step succeeded
                if (isStepSuccessful) {
                    // Step succeeded, update status and mark as completed
                    completedOriginalSteps.add(step.stepNumber);

                    setExecutionState(prev => ({
                        ...prev,
                        stepsStatus: {
                            ...prev.stepsStatus,
                            [step.stepNumber]: "success"
                        }
                    }));

                    addLog("success", `Step ${step.stepNumber} completed: ${result.message || "Success"}`);

                    // Move to next step
                    currentStepIndex++;
                } else {
                    // Step might have failed, but double-check by inspecting HTML
                    // Sometimes steps succeed but are not properly detected
                    const mightActuallyBeSuccessful = await checkIfStepMightBeSuccessful(
                        result.htmlContent || "",
                        step.expectedResult
                    );

                    if (mightActuallyBeSuccessful) {
                        // Step likely succeeded despite the failure report
                        completedOriginalSteps.add(step.stepNumber);

                        setExecutionState(prev => ({
                            ...prev,
                            stepsStatus: {
                                ...prev.stepsStatus,
                                [step.stepNumber]: "success"
                            }
                        }));

                        addLog("success", `Step ${step.stepNumber} appears to have succeeded based on page content`);
                        currentStepIndex++;
                        continue;
                    }

                    // Step failed, mark as failed and stop execution
                    setExecutionState(prev => ({
                        ...prev,
                        stepsStatus: {
                            ...prev.stepsStatus,
                            [step.stepNumber]: "failed"
                        },
                        isRunning: false,
                        status: "failed",
                        lastError: result.detailedError || "Step failed without specific error"
                    }));

                    addLog("error", `Step ${step.stepNumber} failed: ${result.detailedError || "Unknown error"}`);
                    return; // Exit execution on failure
                }
            } catch (error) {
                console.error(`Error executing step ${step.stepNumber}:`, error);

                setExecutionState(prev => ({
                    ...prev,
                    isRunning: false,
                    status: "failed",
                    lastError: error instanceof Error ? error.message : String(error)
                }));

                addLog("error", `Execution stopped due to error: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }
        }

        // Final update to ensure all completed steps are marked as successful
        if (completedOriginalSteps.size > 0) {
            setExecutionState(prev => {
                const updatedStepsStatus = { ...prev.stepsStatus };

                // Update status for all completed original steps
                completedOriginalSteps.forEach(stepNumber => {
                    updatedStepsStatus[stepNumber] = "success";
                });

                return {
                    ...prev,
                    stepsStatus: updatedStepsStatus,
                    isRunning: false,
                    status: "completed"
                };
            });
        } else {
            // All steps completed
            setExecutionState(prev => ({
                ...prev,
                isRunning: false,
                status: "completed"
            }));
        }

        setFinalMessage("All steps completed successfully!");
        addLog("success", "Script execution completed successfully!");
    };

    // Helper function to check if a step might actually be successful based on HTML content
    const checkIfStepMightBeSuccessful = async (html: string, expectedResult: string): Promise<boolean> => {
        if (!html || !expectedResult) return false;

        try {
            // Simple heuristic: check if the expected result text appears in the HTML
            const expectedLower = expectedResult.toLowerCase();
            const htmlLower = html.toLowerCase();

            // Split the expected result into words and check if most appear in the HTML
            const words = expectedLower.split(/\s+/).filter(w => w.length > 3);
            const matchingWords = words.filter(word => htmlLower.includes(word));

            // If more than 70% of significant words are found, consider it potentially successful
            return matchingWords.length >= Math.ceil(words.length * 0.7);
        } catch (error) {
            console.error("Error in success heuristic check:", error);
            return false;
        }
    };

    // Handler for running the script with context - UPDATED for dynamic execution
    const handleRunWithContext = async () => {
        if (executionState.isRunning) {
            return; // Prevent multiple runs
        }

        // Reset state for a new run
        const initialStepsStatus: { [key: number]: "pending" | "running" | "success" | "failed" } = {};
        editableScript.steps.forEach(step => {
            initialStepsStatus[step.stepNumber] = "pending";
        });

        setExecutionState({
            currentStepIndex: 0,
            isRunning: true,
            status: "running",
            stepsStatus: initialStepsStatus,
            logs: [],
            lastError: undefined
        });

        setFinalMessage("");
        addLog("info", "Starting script execution...");

        try {
            // Always grab the active tab first
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab?.id) {
                throw new Error("No active tab found");
            }

            let updatedScript = editableScript;

            // Handle context updates if needed (same as before)
            if (contextPrompt.trim()) {
                try {
                    setFinalMessage("Updating script with context...");
                    addLog("info", "Updating script with context...");

                    const scriptId = (script as ParsedScript & { id?: number }).id;

                    if (!scriptId) {
                        throw new Error("Script ID not found, cannot update with context");
                    }

                    const response = await fetch(`${getApiBaseUrl()}/api/scripts/${scriptId}/update-with-context`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json',
                            'ngrok-skip-browser-warning': 'true'
                        },
                        body: JSON.stringify({ context: contextPrompt.trim() })
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to update script with context: ${response.status} ${response.statusText}`);
                    }

                    const updatedScriptData = await response.json();
                    updatedScript = {
                        ...editableScript,
                        ...updatedScriptData
                    };

                    addLog("success", "Script updated with context successfully!");
                } catch (contextError: any) {
                    console.error("Error updating script with context:", contextError);
                    addLog("error", `Error updating script: ${contextError.message}. Running original version...`);
                }
            }

            // Execute the script steps dynamically - pass the active tab
            await executeScriptSteps(tab.id, updatedScript, tab);

            // If onRun prop is provided, call it with the updated script
            if (onRun) {
                onRun(updatedScript, contextPrompt);
            }
        } catch (e: any) {
            setExecutionState(prev => ({
                ...prev,
                isRunning: false,
                status: "failed",
                lastError: e.message || "Unknown error"
            }));
            addLog("error", `Script execution failed: ${e.message || "Unknown error"}`);
        }
    };

    return (
        <div className="script-details">
            <div className="script-details__header">
                <div className="script-details__title-container">
                    <h1 className="script-details__title">{editableScript.metadata.title}</h1>
                    {/* Edit Icon */}
                    <button onClick={handleEditToggle} className="icon-button" title={isEditing ? "Cancel Edit" : "Edit Locally"}>
                        {isEditing ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg> // Close icon
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg> // Edit icon
                        )}
                    </button>
                    {/* Share Button */}
                    <button
                        onClick={handleShareClick}
                        className="icon-button share-button"
                        title="Copy share link"
                        disabled={!editableScript.id} // Disable if no ID
                    >
                        {isShareCopied ? (
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg> // Checkmark
                        ) : (
                            <ShareIcon />
                        )}
                    </button>
                    {/* Save to DB Icon (only visible when editing) */}
                    {isEditing && (
                        <button onClick={handleSaveToDB} className="icon-button" title="Save to Database">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                        </button>
                    )}
                </div>
                <p className="script-details__summary">{editableScript.summary}</p>
            </div>

            <div className="script-details__info">
                <div className="script-details__info-item">
                    <span className="script-details__info-label">URL:</span>
                    <a href={editableScript.metadata.url} className="script-details__info-value script-details__link" target="_blank" rel="noopener noreferrer">
                        {editableScript.metadata.url}
                    </a>
                </div>
                <div className="script-details__info-item">
                    <span className="script-details__info-label">Steps:</span>
                    <span className="script-details__info-value">{editableScript.metadata.totalSteps}</span>
                </div>
            </div>

            <div className="script-details__context">
                <label htmlFor="context-prompt" className="script-details__context-label">Context / Instructions:</label>
                <textarea
                    id="context-prompt"
                    className="script-details__context-textarea"
                    placeholder="Provide additional context or specific instructions for this run..."
                    value={contextPrompt}
                    onChange={(e) => setContextPrompt(e.target.value)}
                />
            </div>

            <div className="script-details__steps">
                <h2 className="script-details__steps-title">Steps</h2>

                <div className="script-details__steps-list" ref={stepsListRef}>
                    {editableScript.steps.map((step) => {
                        const stepStatus = executionState.stepsStatus[step.stepNumber];
                        const isCurrentStep = executionState.currentStepIndex === editableScript.steps.indexOf(step);

                        return (
                            <div key={step.stepNumber}
                                ref={(el: HTMLDivElement | null) => { stepRefs.current[step.stepNumber] = el; }}
                                className={`script-details__step ${stepStatus ? `script-details__step--${stepStatus}` : ''} 
                                           ${isCurrentStep ? 'script-details__step--current' : ''}`}>
                                <div className="script-details__step-header">
                                    <span className="script-details__step-number">{step.stepNumber}</span>
                                    <span className="script-details__step-action">{step.action}</span>

                                    {/* Status indicator */}
                                    <span className="script-details__step-status">
                                        {stepStatus === "pending" && <span>⌛</span>}
                                        {stepStatus === "running" && <span>🔄</span>}
                                        {stepStatus === "success" && <span>✅</span>}
                                        {stepStatus === "failed" && <span>❌</span>}
                                    </span>
                                </div>

                                <div className="script-details__step-body">
                                    <div className="script-details__step-item">
                                        <span className="script-details__step-label">Target:</span>
                                        <span className="script-details__step-value">{step.target}</span>
                                    </div>

                                    {step.value && (
                                        <div className="script-details__step-item">
                                            <span className="script-details__step-label">Value:</span>
                                            <span className="script-details__step-value">{step.value}</span>
                                        </div>
                                    )}

                                    <div className="script-details__step-item">
                                        <span className="script-details__step-label">URL:</span>
                                        <span className="script-details__step-value">{step.url}</span>
                                    </div>

                                    <div className="script-details__step-item">
                                        <span className="script-details__step-label">Expected Result:</span>
                                        <span className="script-details__step-value">{step.expectedResult}</span>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Execution logs */}
            {executionState.logs.length > 0 && (
                <div className="script-details__logs">
                    <h3>Execution Logs</h3>
                    <div className="script-details__logs-container">
                        {executionState.logs.map((log, index) => (
                            <div key={index} className={`script-details__log script-details__log--${log.type}`}>
                                <span className="script-details__log-time">
                                    {log.timestamp.toLocaleTimeString()}
                                </span>
                                <span className="script-details__log-message">{log.message}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {finalMessage && (
                <div style={{ margin: "1rem 0", padding: "0.5rem", background: "#eef" }}>
                    <strong>Done:</strong> {finalMessage}
                </div>
            )}

            {executionState.lastError && (
                <div style={{ margin: "1rem 0", padding: "0.5rem", background: "#fee" }}>
                    <strong>Error:</strong> {executionState.lastError}
                </div>
            )}

            <div className="script-details__actions">
                <button
                    className="button button--primary"
                    onClick={handleRunWithContext}
                    disabled={executionState.isRunning}
                >
                    {executionState.isRunning ? "Running..." : "Run Script"}
                </button>
                <button
                    className="button button--secondary"
                    onClick={onBack}
                    disabled={executionState.isRunning}
                >
                    Back
                </button>
            </div>

            <style>
                {`
                .script-details__step--pending { opacity: 0.7; }
                .script-details__step--running { border-left: 3px solid #2196F3; }
                .script-details__step--success { border-left: 3px solid #4CAF50; }
                .script-details__step--failed { border-left: 3px solid #F44336; }
                .script-details__step--current { background-color: rgba(33, 150, 243, 0.1); }
                
                .script-details__logs {
                    margin-top: 1rem;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                    max-height: 200px;
                    overflow-y: auto;
                }
                
                .script-details__logs-container {
                    padding: 0.5rem;
                }
                
                .script-details__log {
                    margin-bottom: 4px;
                    padding: 4px 8px;
                    border-radius: 2px;
                    font-family: monospace;
                    font-size: 0.85rem;
                }
                
                .script-details__log--info { background-color: #f5f5f5; }
                .script-details__log--success { background-color: #e8f5e9; }
                .script-details__log--error { background-color: #ffebee; }
                
                .script-details__log-time {
                    color: #757575;
                    margin-right: 8px;
                }
                `}
            </style>
        </div>
    );
}; 