import React, { useState, useEffect } from "react";
import { ScriptDetailsView } from './ScriptDetailsView.tsx';

interface Script {
    id: string;
    session_id: string;
    content: string;
    status: string;
    created_at: string;
}

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
    metadata: { title: string; url: string; totalSteps: number };
    steps: { stepNumber: number; action: string; target: string; value: string | null; url: string; expectedResult: string }[];
    summary: string;
}

interface ShowScriptsViewProps {
    onBack: () => void;
    scripts: Script[];
    onNewScriptClick?: () => void;
    onScriptSelect: (script: ParsedScript) => void;
}

export const ShowScriptsView: React.FC<ShowScriptsViewProps> = ({ onBack, scripts, onNewScriptClick }) => {
    const [selectedSession, setSelectedSession] = useState<string>("all");
    const [availableSessions, setAvailableSessions] = useState<string[]>([]);
    const [selectedScript, setSelectedScript] = useState<ParsedScript | null>(null);

    // Generate a list of unique session IDs
    useEffect(() => {
        const sessions = [...new Set(scripts.map(script => script.session_id).filter(Boolean))];
        setAvailableSessions(sessions);
    }, [scripts]);

    // Filter scripts based on selected session
    const filteredScripts = selectedSession === "all"
        ? scripts
        : scripts.filter(script => script.session_id === selectedSession);

    // Parse JSON content into a more structured format
    const parseScriptContent = (content: string): ParsedScript | null => {
        try {
            return JSON.parse(content);
        } catch (e) {
            console.error("Failed to parse script content:", e);
            return null;
        }
    };

    const formatDate = (dateString: string): string => {
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        } catch (e) {
            return dateString;
        }
    };

    const handleCardClick = (script: Script) => {
        const parsedContent = parseScriptContent(script.content);
        if (parsedContent) {
            setSelectedScript(parsedContent);
        }
    };

    const handleBackFromDetails = () => {
        setSelectedScript(null);
    };

    // If a script is selected, show its details
    if (selectedScript) {
        return <ScriptDetailsView script={selectedScript} onBack={handleBackFromDetails} />;
    }

    return (
        <div className="script-browser">
            <div className="script-browser__controls">
                <button
                    className="button button--primary script-browser__add-btn"
                    onClick={onNewScriptClick}
                    disabled={!onNewScriptClick}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>New Script</span>
                </button>
                <div className="script-filter">
                    <label htmlFor="session-filter">Session:</label>
                    <select
                        id="session-filter"
                        value={selectedSession}
                        onChange={(e) => setSelectedSession(e.target.value)}
                        className="script-filter__select"
                    >
                        <option value="all">All</option>
                        {availableSessions.map(sessionId => (
                            <option key={sessionId} value={sessionId}>{sessionId.substring(0, 8)}...</option>
                        ))}
                    </select>
                </div>
            </div>

            <div className="script-list">
                {filteredScripts.length === 0 ? (
                    <p className="script-list__empty">No scripts found.</p>
                ) : (
                    filteredScripts.map(script => {
                        const parsedContent = parseScriptContent(script.content);

                        return (
                            <div
                                key={script.id}
                                className="script-card script-card--clickable"
                                onClick={() => handleCardClick(script)}
                            >
                                <div className="script-card__header">
                                    <h2 className="script-card__title">
                                        {parsedContent?.metadata?.title || "Untitled Script"}
                                    </h2>
                                </div>
                                <div className="script-card__meta">
                                    <span className="script-card__status">{script.status}</span>
                                    <span className="script-card__date">{formatDate(script.created_at)}</span>
                                    <span className="script-card__steps-count">
                                        {parsedContent?.steps?.length || 0} steps
                                    </span>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <button onClick={onBack} className="button button--secondary script-browser__back">
                Back
            </button>
        </div>
    );
}; 