import React from 'react';
import { MockUser, MockScope } from '../main.tsx'; // Import types from main

interface MarketplaceScopeListViewProps {
    user: MockUser; // The user whose scopes are being displayed
    onScopeSelect: (scope: MockScope) => void;
    onBackToUsers: () => void; // Go back to the user list
}

export const MarketplaceScopeListView: React.FC<MarketplaceScopeListViewProps> = ({
    user,
    onScopeSelect,
    onBackToUsers
}) => {
    const scopes = user.scopes || [];

    return (
        <div className="scope-browser">
            <div className="scope-browser__header">
                <button
                    className="button button--secondary scope-browser__back-btn"
                    onClick={onBackToUsers}
                >
                    Back to Users
                </button>
                <h2 className="scope-browser__title">
                    {user.name}'s Scopes
                </h2>
                {/* Placeholder for alignment */}
                <div style={{ width: '120px' }}></div>
            </div>

            <div className="scope-list">
                {scopes.length === 0 ? (
                    <p className="scope-list__empty">{user.name} has no defined scopes yet.</p>
                ) : (
                    scopes.map(scope => (
                        <div
                            key={scope.id}
                            className="scope-card scope-card--clickable"
                            onClick={() => onScopeSelect(scope)}
                        >
                            <div className="scope-card__icon">{scope.icon || '📁'}</div>
                            <div className="scope-card__content">
                                <h3 className="scope-card__name">{scope.name}</h3>
                                {scope.description && <p className="scope-card__description">{scope.description}</p>}
                            </div>
                            <div className="scope-card__arrow">➔</div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};