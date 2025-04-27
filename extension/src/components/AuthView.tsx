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

// Interface for the expected response from GET /api/users/:email
interface UserResponse {
    id: string;
    name: string;
    email: string;
    // other fields...
}

const CUSTOM_HTML_ERROR_MESSAGE = "We're having difficulties connecting with the backend :( Try again in a sec";

export const AuthView: React.FC<AuthViewProps> = ({ onAuthSuccess, baseUrl }) => {
  // Initialize state directly to empty strings
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Helper function to fetch user ID by email
  const fetchUserIdByEmail = async (userEmail: string): Promise<string | null> => {
    console.log(`Fetching user ID for email: ${userEmail}`);
    try {
      const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(userEmail)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
      });
      console.log(`GET /api/users/${userEmail} status: ${response.status}`);

      if (!response.ok) {
          let errorText = 'Unknown error';
          try {
             // Clone before reading text for error logging
             errorText = await response.clone().text(); 
             console.error(`Failed to fetch user by email. Status: ${response.status}, Response: ${errorText}`);
          } catch (e) {
             console.error(`Failed to fetch user by email. Status: ${response.status}. Could not read response text.`);
          }
          // Handle specific statuses if needed
          if (response.status === 404) {
             setError("User with this email not found.");
          } else {
             setError(`Server error fetching user details (Status: ${response.status})`);
          }
          return null;
      }

      // If response.ok, try reading the original response body as JSON
      try {
          const userData: UserResponse = await response.json(); // Read original response as JSON
          console.log("Parsed user data:", userData);
          return userData.id || null;
      } catch (parseError) {
          console.error("Failed to parse successful response as JSON:", parseError);
          // Try reading as text for logging if JSON parsing fails
          try {
              const responseText = await response.clone().text(); // Clone again to read text
              console.error("Response text that failed JSON parsing:", responseText);
          } catch (e) {
              console.error("Could not read response text after JSON parse failed.");
          }
          setError("Received invalid data format from server when fetching user details.");
          return null;
      }
    } catch (fetchError: any) {
      // This catches network errors (fetch itself failed)
      console.error("Network error during fetch user ID by email call:", fetchError);
      setError(`Network error fetching user details: ${fetchError.message}`);
      return null; // Return null on error
    }
  };

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
    let userId: string | null = null;
    let finalUserData: any = { ...userDetails, id: null };

    try {
      const response = await fetch(`${baseUrl}/api/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        },
        body: JSON.stringify(userDetails),
      });

      const contentType = response.headers.get('content-type');
      if (contentType && !contentType.includes('application/json')) {
        try {
            const textResponse = await response.text();
            if (textResponse.trim().toLowerCase().startsWith('<!doctype html')) {
                throw new Error(CUSTOM_HTML_ERROR_MESSAGE);
            }
             throw new Error(textResponse || `Unexpected content type: ${contentType}`);
        } catch (textError) {
             throw new Error(`Unexpected response format received from server.`);
        }
      }

      const data = await response.json();

      if (response.ok) { 
          console.log('User created successfully:', data);
          userId = data?.id; 
          finalUserData = data; 
      } else if (response.status === 409) { 
          console.log('User already exists (409 Conflict). Fetching user ID...');
          userId = await fetchUserIdByEmail(email);
          console.log('Fetched user ID:', userId);
          finalUserData = { ...userDetails, id: userId };
      } else { 
          const errorMessage = data?.message || `Error: ${response.status} ${response.statusText}`;
          throw new Error(errorMessage);
      }

      if (!userId) {
          console.warn("Could not determine User ID after auth attempt. ID will not be stored.");
      }

      try {
        const storageData = { 
            userName: name, 
            userEmail: email, 
            userId: userId // Store the determined ID (or null if not found)
        };
        await chrome.storage.local.set(storageData);
        console.log("User details (including ID) saved to local storage:", storageData);
      } catch (storageError) {
        console.warn("Error saving user details to local storage:", storageError);
      }

      onAuthSuccess(finalUserData);

    } catch (err: any) {
      console.error("Authentication error:", err);
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