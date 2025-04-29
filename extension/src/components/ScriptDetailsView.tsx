import React, { useState } from 'react';
import { samplingLoop } from "../utils/ComputerUseLoop.tsx";

interface ScriptMetadata {
    title: string;
    url: string;
    totalSteps: number;
}

interface ScriptStep {
    stepNumber: number;
    action: string;
    target: string;
    value: string | null;
    url: string;
    expectedResult: string;
}

interface ParsedScript {
    id?: string;
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

export const ScriptDetailsView: React.FC<ScriptDetailsViewProps> = ({ script, onBack, onRun }) => {
    // Local state for edits and context
    const [editableScript, setEditableScript] = useState<ParsedScript>(script);
    const [isEditing, setIsEditing] = useState(false); // Track if the script is being edited locally
    const [contextPrompt, setContextPrompt] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [finalMessage, setFinalMessage] = useState<string>("");

    // Get the base URL for API calls
    const getApiBaseUrl = () => {
        // For development
        if (process.env.DEV_API) {
            return process.env.DEV_API;
        }
        // For production, try to use the server URL from extension settings
        // or fall back to default localhost URL
        return "https://faf7-65-112-8-50.ngrok-free.app";
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

    // Handler for running the script with context
    const handleRunWithContext = async () => {
        setError(null);
        setLoading(true);
        setFinalMessage("");

        try {
            // Always grab the active tab first
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

            if (!tab?.id) {
                throw new Error("No active tab found");
            }

            let updatedScript = editableScript;

            // If context is provided, update the script with the new context
            if (contextPrompt.trim()) {
                try {
                    setFinalMessage("Updating script with context...");

                    // Access the ID using type assertion 
                    const scriptId = (script as ParsedScript & { id?: string }).id;

                    if (!scriptId) {
                        throw new Error("Script ID not found, cannot update with context");
                    }

                    // Call the server endpoint to update the script with context
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
                    // Update the script with the new content from the server
                    updatedScript = {
                        ...editableScript,
                        ...updatedScriptData
                    };

                    setFinalMessage("Script updated with context successfully!");
                } catch (contextError: any) {
                    console.error("Error updating script with context:", contextError);
                    setFinalMessage(`Error updating script: ${contextError.message}. Running original version...`);
                }
            }

            // Use the same logic as AutoActionView, but with the potentially updated script
            let result = "";
            console.log("Running script:", JSON.stringify(updatedScript.steps));
            for (const [i, step] of updatedScript.steps.entries() || []) {
                console.log("Running step:", step);
                // Pass the instruction without context (it's already incorporated in the updated script)
                const instruction = JSON.stringify(step);
                console.log("Instruction:", instruction);
                result = await samplingLoop(tab.id, instruction, i.toString(), console.log, 10);
            }
            console.log("Automation completed:", result);
            setFinalMessage(result);

            // If onRun prop is provided, call it with the updated script
            if (onRun) {
                onRun(updatedScript, contextPrompt);
            }
        } catch (e: any) {
            setError(e.message || "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    // Placeholder for input change handling if fields become editable
    // const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    //     const { name, value } = e.target;
    //     // Update nested state logic...
    // };

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

                <div className="script-details__steps-list">
                    {editableScript.steps.map((step) => (
                        <div key={step.stepNumber} className="script-details__step">
                            <div className="script-details__step-header">
                                <span className="script-details__step-number">{step.stepNumber}</span>
                                <span className="script-details__step-action">{step.action}</span>
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
                    ))}
                </div>
            </div>

            {finalMessage && (
                <div style={{ margin: "1rem 0", padding: "0.5rem", background: "#eef" }}>
                    <strong>Done:</strong> {finalMessage}
                </div>
            )}

            {error && (
                <div style={{ margin: "1rem 0", padding: "0.5rem", background: "#fee" }}>
                    <strong>Error:</strong> {error}
                </div>
            )}

            <div className="script-details__actions">
                {/* Updated Run button to use context and show loading state */}
                <button
                    className="button button--primary"
                    onClick={handleRunWithContext}
                    disabled={loading}
                >
                    {loading ? "Running..." : "Run Script"}
                </button>
                <button className="button button--secondary" onClick={onBack} disabled={loading}>Back</button>
            </div>
        </div>
    );
}; 