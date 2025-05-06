import React from 'react';

// Assuming MockUser interface is defined/imported elsewhere or defined here
interface MockUser {
    id: number;
    name: string;
    email: string;
    profileImageUrl?: string;
    skills?: string[];
    focus?: string;
}

interface MarketplaceUserListViewProps {
    users: MockUser[];
    onUserSelect: (user: MockUser) => void;
    onShowMyScriptsClick: () => void;
    searchQuery: string; // Keep search props if needed for user search later
    onSearchChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const MarketplaceUserListView: React.FC<MarketplaceUserListViewProps> = ({
    users,
    onUserSelect,
    onShowMyScriptsClick,
    searchQuery,
    onSearchChange
}) => {

    // Basic filtering for users based on name (can be expanded)
    const filteredUsers = users.filter(user =>
        user.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="script-browser marketplace-user-list">
            <div className="script-browser__controls">
                {/* My Scripts Button */}
                <button
                    className="button button--secondary script-browser__nav-btn"
                    onClick={onShowMyScriptsClick}
                >
                    My Scripts
                </button>

                {/* Search Bar */}
                <input
                    type="text"
                    placeholder="Search users..." // Updated placeholder
                    className="script-browser__search"
                    value={searchQuery}
                    onChange={onSearchChange}
                />

                {/* Placeholder for alignment, or add different button? */}
                <div style={{ width: '60px' }}></div> { /* Adjust width as needed */}
            </div>

            <div className="user-list">
                {filteredUsers.length === 0 ? (
                    <p className="user-list__empty">{searchQuery ? 'No users match your search.' : 'No users found in marketplace.'}</p>
                ) : (
                    filteredUsers.map(user => (
                        <div
                            key={user.id}
                            className="user-card user-card--clickable"
                            onClick={() => onUserSelect(user)}
                        >
                            <div className="user-card__header">
                                <img
                                    src={user.profileImageUrl || `https://via.placeholder.com/40/CCCCCC/808080?text=${user.name[0]}`}
                                    alt={`${user.name}'s profile`}
                                    className="user-card__image"
                                />
                                <h2 className="user-card__name">{user.name}</h2>
                            </div>
                            <div className="user-card__body">
                                {user.focus && <p className="user-card__focus">Focus: {user.focus}</p>}
                                {user.skills && user.skills.length > 0 && (
                                    <div className="user-card__skills">
                                        Skills: {user.skills.map(skill => (
                                            <span key={skill} className="skill-tag">{skill}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* No overall back button here, navigation is via 'My Scripts' */}
        </div>
    );
}; 