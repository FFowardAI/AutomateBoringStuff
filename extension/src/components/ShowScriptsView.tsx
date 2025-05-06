import React, { useState, useEffect } from "react";
import { ShareIcon } from './icons/ShareIcon.tsx';

interface Script {
    id: number;
    recording_id: number;
    content: string;
    status: string;
    created_at: string;
    is_structured?: boolean;
    structured_data?: Record<string, any> | null;
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
    id?: number;
    metadata: { title: string; url: string; totalSteps: number };
    steps: { stepNumber: number; action: string; target: string; value: string | null; url: string; expectedResult: string }[];
    summary: string;
    rawContent?: string;
}

interface ShowScriptsViewProps {
    onBack: () => void;
    scripts: Script[];
    onNewScriptClick?: () => void;
    onScriptSelect: (script: Script) => void;
    scriptViewMode: 'user' | 'marketplace';
    searchQuery: string;
    onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onMarketplaceClick: () => void;
    onShowMyScriptsClick: () => void;
}

export const ShowScriptsView: React.FC<ShowScriptsViewProps> = ({
    onBack,
    scripts,
    onNewScriptClick,
    onScriptSelect,
    scriptViewMode,
    searchQuery,
    onSearchChange,
    onMarketplaceClick,
    onShowMyScriptsClick
}) => {
    const [copiedScriptId, setCopiedScriptId] = useState<number | null>(null);

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

    const handleShareClick = (event: React.MouseEvent, scriptId: number) => {
        event.stopPropagation();
        const shareUrl = `#script-${scriptId}`;
        navigator.clipboard.writeText(shareUrl).then(() => {
            console.log(`Copied link for script ${scriptId}: ${shareUrl}`);
            setCopiedScriptId(scriptId);
            setTimeout(() => setCopiedScriptId(null), 1500);
        }).catch(err => {
            console.error('Failed to copy script link: ', err);
        });
    };

    const handleCardClick = (script: Script) => {
        onScriptSelect(script);
    };

    return (
        <div className="script-browser">
            <div className="script-browser__controls">
                {/* Show 'My Scripts' button when in marketplace view */}
                {scriptViewMode === 'marketplace' && (
                    <button
                        className="button button--secondary script-browser__nav-btn"
                        onClick={onShowMyScriptsClick}
                    >
                        My Scripts
                    </button>
                )}
                {/* Show 'Marketplace' button only when viewing own scripts */}
                {scriptViewMode === 'user' && (
                    <button
                        className="button button--secondary script-browser__nav-btn"
                        onClick={onMarketplaceClick}
                    >
                        Marketplace
                    </button>
                )}
                {/* Show 'Back to Marketplace' button when viewing a specific marketplace user's scripts? */}
                {scriptViewMode === 'marketplace' && (
                    <button
                        className="button button--secondary script-browser__nav-btn"
                        onClick={onMarketplaceClick}
                    >
                        Back to Users
                    </button>
                )}

                {/* Search Bar - placeholder changes based on context */}
                <input
                    type="text"
                    placeholder={scriptViewMode === 'user' ? "Search my scripts..." : "Search user's scripts..."}
                    className="script-browser__search"
                    value={searchQuery}
                    onChange={onSearchChange}
                />

                <button
                    className="button button--primary script-browser__add-btn"
                    onClick={onNewScriptClick}
                    disabled={!onNewScriptClick}
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                    </svg>
                    <span>New</span>
                </button>
            </div>

            <div className="script-list">
                {scripts.length === 0 ? (
                    <p className="script-list__empty">{searchQuery ? 'No scripts match your search.' : (scriptViewMode === 'user' ? 'You have no scripts yet.' : 'No marketplace scripts found.')}</p>
                ) : (
                    scripts.map(script => {
                        let displayTitle = `Script ${script.id}`;
                        try {
                            const parsed = JSON.parse(script.content);
                            if (parsed?.metadata?.title) {
                                displayTitle = parsed.metadata.title;
                            }
                        } catch { /* Ignore parsing errors for title */ }

                        return (
                            <div
                                key={script.id}
                                className="script-card script-card--clickable"
                                onClick={() => handleCardClick(script)}
                            >
                                <div className="script-card__header">
                                    <h2 className="script-card__title">
                                        {displayTitle}
                                    </h2>
                                    <button
                                        className="icon-button share-button script-card__share-btn"
                                        title="Copy share link"
                                        onClick={(e) => handleShareClick(e, script.id)}
                                    >
                                        {copiedScriptId === script.id ? (
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                                        ) : (
                                            <ShareIcon width={16} height={16} />
                                        )}
                                    </button>
                                </div>
                                <div className="script-card__meta">
                                    <span className="script-card__status">{script.status || 'Unknown'}</span>
                                    <span className="script-card__date">{formatDate(script.created_at)}</span>
                                    <span className="script-card__steps-count">
                                        {(() => {
                                            try {
                                                const parsed = JSON.parse(script.content);
                                                return `${parsed?.steps?.length || 0} steps`;
                                            } catch {
                                                return '? steps';
                                            }
                                        })()}
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