import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface AuthViewProps {
  onAuthSuccess: (userData: { name: string, email: string, id: null, profileImageUrl: string }) => void; // User data from Google
  baseUrl: string; // Pass the backend base URL
}

const CUSTOM_HTML_ERROR_MESSAGE = "We're having difficulties connecting with the backend :( Try again in a sec";

export const AuthView: React.FC<AuthViewProps> = ({ onAuthSuccess, baseUrl }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = () => {
    setError(null);
    setIsLoading(true);

    // First clear any existing token to force re-authentication
    chrome.identity.clearAllCachedAuthTokens(() => {
      // Then get a new token with interactive mode
      chrome.identity.getAuthToken({ interactive: true }, (token) => {
        if (chrome.runtime.lastError || !token) {
          setError(chrome.runtime.lastError?.message || "Failed to get Google auth token.");
          setIsLoading(false);
          return;
        }
        // Use the token to get user info
        fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
          headers: { Authorization: `Bearer ${token}` }
        })
          .then(response => {
            if (!response.ok) {
              throw new Error(`Google API error: ${response.status}`);
            }
            return response.json();
          })
          .then(userInfo => {
            if (userInfo && userInfo.email) {
              console.log("Google user info:", userInfo);
              // Pass necessary info (name, email) to the parent
              // The DB ID will be determined in the parent component
              onAuthSuccess({
                name: userInfo.name || userInfo.email, // Use email as fallback name
                email: userInfo.email,
                id: null, // DB ID is null for now
                profileImageUrl: userInfo.picture // Add the profile image URL
              });
            } else {
              throw new Error("Failed to retrieve valid user info from Google.");
            }
          })
          .catch(err => {
            setError(err.message || "Error fetching Google user info.");
            setIsLoading(false);
            // Optional: Revoke token if fetching user info failed?
            // chrome.identity.removeCachedAuthToken({ token: token }, () => {});
          });
      });
    });
  };

  return (
    <motion.div
      key="auth"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="auth-view"
    >
      <h2>Sign In</h2>
      <p>Please sign in with your Google account to continue.</p>
      <button
        onClick={handleGoogleSignIn}
        className="button button--primary"
        disabled={isLoading}
      >
        {/* Improved Google logo SVG */}
        <svg width="18" height="18" viewBox="0 0 18 18">
          <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
          <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" />
          <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
          <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
        </svg>
        {isLoading ? 'Signing In...' : 'Sign in with Google'}
      </button>
      {error && <p className="error-message">{error}</p>}
    </motion.div>
  );
}; 