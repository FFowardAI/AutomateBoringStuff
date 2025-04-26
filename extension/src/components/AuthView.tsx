import React, { useState } from 'react';
import { motion } from 'framer-motion';

interface AuthViewProps {
  onAuthSuccess: (userData: any) => void; // Callback when login/creation succeeds
  baseUrl: string; // Pass the backend base URL
}

// Define a simple structure for the user data we handle in this component
interface UserInput {
  name: string;
  email: string;
}

const CUSTOM_HTML_ERROR_MESSAGE = "We're having difficulties connecting with the backend :( Try again in a sec";

export const AuthView: React.FC<AuthViewProps> = ({ onAuthSuccess, baseUrl }) => {
  // Initialize state directly to empty strings
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuth = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    if (!email || !name) {
      setError("Please enter both name and email.");
      setIsLoading(false);
      return;
    }

    const userDetails: UserInput = { name, email };

    try {
      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json', // Explicitly request JSON
        },
        body: JSON.stringify(userDetails),
      });

      // Check for HTML response before trying to parse JSON
      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        try {
            const textResponse = await response.text();
            if (textResponse.trim().toLowerCase().startsWith('<!doctype html')) {
                console.warn("Received HTML response instead of JSON from backend.");
                throw new Error(CUSTOM_HTML_ERROR_MESSAGE);
            }
            // If not HTML, maybe plain text error? Try to use it.
             throw new Error(textResponse || `Unexpected content type: ${contentType}`);
        } catch (textError) {
             // If reading text fails, fall back to generic error
             console.error("Failed to read non-JSON response body:", textError);
             throw new Error(`Unexpected response format received from server.`);
        }
      }

      // Proceed assuming JSON response
      const data = await response.json();

      // Check if response is OK OR if it's a 409 Conflict (duplicate user)
      if (response.ok || response.status === 409) {
        // If 409, log that we are treating it as success
        if (response.status === 409) {
          console.log('User already exists (409 Conflict), treating as login success.');
        } else {
          console.log('Auth successful:', data);
        }

        // Save name and email to local storage on success or 409
        try {
          await chrome.storage.local.set({ userName: name, userEmail: email });
          console.log("User name and email saved to local storage.");
        } catch (storageError) {
          console.warn("Error saving user details to local storage:", storageError);
        }

        // Pass back user data (either from response or the input if 409)
        // The parent component might need a user ID, which we won't have on 409.
        // Consider fetching the user data with GET /api/users?email=... after a 409 if needed.
        onAuthSuccess(response.ok ? data : { ...userDetails, id: null }); // Pass input data back on 409

      } else {
        // Handle other errors (not OK and not 409)
        const errorMessage = data?.message || `Error: ${response.status} ${response.statusText}`;
        throw new Error(errorMessage);
      }

    } catch (err: any) {
      console.error("Authentication error:", err);
       // Use the custom message if it was thrown, otherwise use the caught error message
      setError(err.message === CUSTOM_HTML_ERROR_MESSAGE ? CUSTOM_HTML_ERROR_MESSAGE : (err.message || "An unexpected error occurred."));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      key="auth"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="auth-view"
      style={{ padding: '20px', textAlign: 'center' }}
    >
      <h2>Login / Sign Up</h2>
      <p>Enter your name and email to continue.</p>
      <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Your Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={isLoading}
          style={{ padding: '8px', width: '200px' }}
        />
        <input
          type="email"
          placeholder="Your Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isLoading}
          style={{ padding: '8px', width: '200px' }}
        />
        <button type="submit" className="button button--primary" disabled={isLoading}>
          {isLoading ? 'Processing...' : 'Continue'}
        </button>
        {error && <p style={{ color: 'red', marginTop: '10px' }}>{error}</p>}
      </form>
    </motion.div>
  );
}; 