import React, { useState, useEffect } from "react";

interface Script {
    id: string;
    session_id: string;
    content: string;
    status: string;
    created_at: string;
}

interface ShowScriptsViewProps {
    onScriptSelect: (script: Script) => void;
    onBack: () => void;
    baseUrl: string;
}

export const ShowScriptsView: React.FC<ShowScriptsViewProps> = ({
    onScriptSelect,
    onBack,
    baseUrl
}) => {
    const [scripts, setScripts] = useState<Script[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<{ id: string, context: string }[]>([]);

    useEffect(() => {
        const fetchSessions = async () => {
            try {
                const response = await fetch(`${baseUrl}/api/sessions`, {
                    headers: {
                        'Accept': 'application/json',
                        'ngrok-skip-browser-warning': 'true'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch sessions: ${response.status}`);
                }

                const data = await response.json();
                setSessions(data);
            } catch (err) {
                console.error("Error fetching sessions:", err);
                setError("Failed to load sessions");
            }
        };

        fetchSessions();
    }, [baseUrl]);

    useEffect(() => {
        const fetchScripts = async () => {
            setLoading(true);
            setError(null);

            try {
                const url = selectedSessionId
                    ? `${baseUrl}/api/scripts?session_id=${selectedSessionId}`
                    : `${baseUrl}/api/scripts/all`;

                const response = await fetch(url, {
                    headers: {
                        'Accept': 'application/json',
                        'ngrok-skip-browser-warning': 'true'
                    }
                });

                if (!response.ok) {
                    throw new Error(`Failed to fetch scripts: ${response.status}`);
                }

                const data = await response.json();
                setScripts(data);
            } catch (err) {
                console.error("Error fetching scripts:", err);
                setError("Failed to load scripts");
            } finally {
                setLoading(false);
            }
        };

        fetchScripts();
    }, [baseUrl, selectedSessionId]);

    const handleSessionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const id = e.target.value;
        setSelectedSessionId(id === "all" ? null : id);
    };

    const formatDate = (dateString: string) => {
        try {
            const date = new Date(dateString);
            return date.toLocaleString();
        } catch (err) {
            return dateString;
        }
    };

    const truncateContent = (content: string, maxLength = 100) => {
        if (content.length <= maxLength) return content;
        return content.substring(0, maxLength) + "...";
    };

    return (
        <div style={{ padding: "1rem" }}>
            <h4>Available Scripts</h4>

            <div style={{ marginBottom: "1rem" }}>
                <label htmlFor="session-select" style={{ marginRight: "0.5rem" }}>
                    Filter by session:
                </label>
                <select
                    id="session-select"
                    value={selectedSessionId || "all"}
                    onChange={handleSessionChange}
                    style={{ padding: "0.3rem" }}
                >
                    <option value="all">All Sessions</option>
                    {sessions.map(session => (
                        <option key={session.id} value={session.id}>
                            {session.context || `Session ${session.id.substring(0, 8)}`}
                        </option>
                    ))}
                </select>
            </div>

            {loading ? (
                <p>Loading scripts...</p>
            ) : error ? (
                <p style={{ color: "red" }}>Error: {error}</p>
            ) : scripts.length === 0 ? (
                <p>No scripts found.</p>
            ) : (
                <div
                    style={{
                        maxHeight: "300px",
                        overflowY: "auto",
                        border: "1px solid #eee",
                        borderRadius: "4px",
                        padding: "0.5rem"
                    }}
                >
                    {scripts.map(script => (
                        <div
                            key={script.id}
                            style={{
                                padding: "0.5rem",
                                marginBottom: "0.5rem",
                                border: "1px solid #ccc",
                                borderRadius: "4px",
                                cursor: "pointer",
                                backgroundColor: script.status === 'completed' ? "#f0fff0" : "#fff0f0"
                            }}
                            onClick={() => onScriptSelect(script)}
                        >
                            <div style={{ fontWeight: "bold" }}>
                                Status: {script.status}
                                <span style={{ float: "right", fontSize: "0.8rem" }}>
                                    {formatDate(script.created_at)}
                                </span>
                            </div>
                            <div style={{
                                fontSize: "0.9rem",
                                marginTop: "0.3rem",
                                whiteSpace: "pre-wrap"
                            }}>
                                {truncateContent(script.content)}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ marginTop: "1rem" }}>
                <button
                    className="button button--secondary"
                    onClick={onBack}
                >
                    Back
                </button>
            </div>
        </div>
    );
}; 