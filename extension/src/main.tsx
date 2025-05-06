import React, { useState, useCallback, useEffect, useMemo } from 'react'
import ReactDOM from 'react-dom/client'
import { AnimatePresence, motion } from 'framer-motion'
import './main.css'
import { EmptyView } from './components/EmptyView.tsx'
import { RecordingView } from './components/RecordingView.tsx'
import { AuthView } from './components/AuthView.tsx'
import { ShowScriptsView } from './components/ShowScriptsView.tsx'
import { ScriptDetailsView } from './components/ScriptDetailsView.tsx'
import { LoadingView } from './components/LoadingView.tsx'
import { PermissionGuideView } from './components/PermissionGuideView.tsx'
import { MarketplaceUserListView } from './components/MarketplaceUserListView.tsx'

// Define expected state structure from background
interface BackgroundState {
  isRecording: boolean;
  screenshots: string[];
}

// Add Auth related types
interface User {
  id: number | null; // Changed to number to match BIGSERIAL
  name: string;
  email: string;
  profileImageUrl?: string; // Add profile image URL
  // Add other relevant user fields from your API response
}

// Type for the expected response when creating a recording
interface RecordingResponse {
  id: number; // Changed to number
  message?: string; // Add optional message for potential errors
}

// Add type for the finalize endpoint response
interface FinalizeResponse {
  script?: {
    id: number; // Changed to number
    content: string;
  };
  message?: string;
  uploaded_images?: any[]; // Keep this if finalize returns uploaded images
}

// Script type
interface Script {
  id: number; // Changed to number
  recording_id: number; // Changed to number, removed session_id
  content: string;
  status: string;
  created_at: string;
  is_structured?: boolean;
  structured_data?: Record<string, any> | null;
}

// Define the structure for parsed script content, used in ScriptDetailsView
interface ParsedScript {
  id?: number; // Changed to number
  metadata: { title: string; url: string; totalSteps: number };
  steps: { stepNumber: number; action: string; target: string; value: string | null; url: string; expectedResult: string }[];
  summary: string;
  rawContent?: string;
}

// Add type for backend user response (adjust based on your actual API)
interface BackendUserResponse {
  id: number; // Changed to number
  name: string;
  email: string;
  permissions?: string | null;
  role_id?: number | null;
  organization_id?: number | null;
}

// Define MockScope interface
interface MockScope {
  id: number;
  name: string;
  description?: string;
  icon?: string; // Optional icon for the scope
}

// Update MockUser interface
interface MockUser {
  id: number;
  name: string;
  email: string;
  profileImageUrl?: string;
  skills?: string[];
  focus?: string;
  scopes?: MockScope[]; // Add scopes array
}

// Combine view states
type ViewState =
  | 'authenticating'
  | 'authRequired'
  | 'loading' // Initial loading of background state
  | 'loadingScripts' // Loading the list of scripts
  | 'empty'
  | 'recording'
  | 'processingAction' // Uploading/finalizing recording
  | 'error'
  | 'permissionRequired' // Added state for screen recording permission
  | 'browseScripts' // Showing the list of scripts
  | 'scriptDetail' // Showing details of a single script
  | 'browseMarketplaceUsers' // Added: Explicit state for user list
  | 'browseMarketplaceScopes'; // Added: Explicit state for scope list

// const API_BASE_URL = "https://31ca-4-39-199-2.ngrok-free.app"; // Define your backend URL
const API_BASE_URL = 'http://localhost:8002'; // Use local backend for development
// AUTH_COOKIE_NAME is no longer checked here, but might still be relevant for backend interactions
// const AUTH_COOKIE_NAME = "auth_session";

// --- Helper Functions --- 

// Helper to convert data URL to Blob
function dataURLtoBlob(dataurl: string): Blob | null {
  try {
    const arr = dataurl.split(',');
    if (!arr[0]) return null;
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) return null;
    const mime = mimeMatch[1];
    const bstr = atob(arr[arr.length - 1]); // Use arr.length - 1 to handle potential commas in data
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch (e) {
    console.error("Error converting data URL to blob:", e);
    return null;
  }
}

const App: React.FC = () => {
  const [viewState, setViewState] = useState<ViewState>('authenticating'); // Start in authenticating state
  const [screenshots, setScreenshots] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [recordingId, setRecordingId] = useState<number | null>(null); // State for backend recording ID
  const [isLoading, setIsLoading] = useState<boolean>(false); // Add loading state for uploads
  const [actionScript, setActionScript] = useState<string | null>(null); // State for the script content
  const [processingStatusText, setProcessingStatusText] = useState<string>(''); // Status text for LoadingView
  const [scripts, setScripts] = useState<Script[]>([]); // State for all scripts
  const [selectedScriptDetail, setSelectedScriptDetail] = useState<ParsedScript | null>(null); // Script being viewed in detail
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false); // State for user dropdown menu
  const [scriptViewMode, setScriptViewMode] = useState<'user' | 'marketplace'>('user'); // 'user' or 'marketplace'
  const [searchQuery, setSearchQuery] = useState(''); // Search input state
  const [marketplaceUsers, setMarketplaceUsers] = useState<MockUser[]>([]); // State for marketplace users
  const [selectedMarketplaceUser, setSelectedMarketplaceUser] = useState<MockUser | null>(null); // Selected user from marketplace

  // --- Mock Data Structures ---
  // MOCK_SCOPED_SCRIPTS: userId -> scopeId -> scripts[]
  const MOCK_SCOPED_SCRIPTS: { [userId: number]: { [scopeId: number]: Script[] } } = {
    101: { // Aleksander
      1001: [ // Sales & Lead Gen Scope
        { id: 501, recording_id: 201, content: JSON.stringify({ metadata: { title: "LinkedIn Lead Finder", url: "linkedin.com", totalSteps: 7 }, steps: [], summary: "Finds potential leads based on job title." }), status: "completed", created_at: "2024-03-10T10:00:00Z" },
        { id: 503, recording_id: 203, content: JSON.stringify({ metadata: { title: "Sales Navigator Export Prep", url: "linkedin.com", totalSteps: 4 }, steps: [], summary: "Prepares saved leads for export." }), status: "completed", created_at: "2024-03-08T15:30:00Z" },
      ],
      1002: [ // Financial Ops Scope
        { id: 502, recording_id: 202, content: JSON.stringify({ metadata: { title: "Invoice Data Entry (Quickbooks)", url: "quickbooks.com", totalSteps: 9 }, steps: [], summary: "Enters invoice details into Quickbooks." }), status: "completed", created_at: "2024-03-09T11:00:00Z" },
        { id: 504, recording_id: 204, content: JSON.stringify({ metadata: { title: "Expense Report Summarizer", url: "expensify.com", totalSteps: 6 }, steps: [], summary: "Summarizes monthly expenses." }), status: "completed", created_at: "2024-03-07T09:00:00Z" },
      ]
    },
    102: { // Danilo
      2001: [ // Web Scraping & Data Entry
        { id: 601, recording_id: 301, content: JSON.stringify({ metadata: { title: "Product Price Scraper (Amazon)", url: "amazon.com", totalSteps: 5 }, steps: [], summary: "Scrapes prices for specific products." }), status: "completed", created_at: "2024-03-10T12:00:00Z" },
        { id: 603, recording_id: 303, content: JSON.stringify({ metadata: { title: "Form Filler 5000", url: "typeform.com", totalSteps: 8 }, steps: [], summary: "Fills standard customer support forms." }), status: "completed", created_at: "2024-03-08T14:45:00Z" },
        { id: 604, recording_id: 304, content: JSON.stringify({ metadata: { title: "Competitor Website Monitor", url: "google.com", totalSteps: 3 }, steps: [], summary: "Checks competitor websites for updates." }), status: "running", created_at: "2024-03-11T09:15:00Z" },
      ],
      2002: [ // General Support Tasks
        { id: 602, recording_id: 302, content: JSON.stringify({ metadata: { title: "Support Ticket Categorizer", url: "zendesk.com", totalSteps: 4 }, steps: [], summary: "Categorizes incoming support tickets." }), status: "completed", created_at: "2024-03-09T11:30:00Z" },
      ]
    },
    103: { // Felipe
      3001: [ // CRM Management
        { id: 701, recording_id: 401, content: JSON.stringify({ metadata: { title: "Salesforce Contact Updater", url: "salesforce.com", totalSteps: 12 }, steps: [], summary: "Updates contact info in Salesforce." }), status: "completed", created_at: "2024-03-09T09:30:00Z" },
        { id: 704, recording_id: 404, content: JSON.stringify({ metadata: { title: "HubSpot Deal Stage Update", url: "hubspot.com", totalSteps: 5 }, steps: [], summary: "Updates deal stages based on criteria." }), status: "completed", created_at: "2024-03-07T16:00:00Z" },
      ],
      3002: [ // Reporting
        { id: 703, recording_id: 403, content: JSON.stringify({ metadata: { title: "Marketing Campaign Report Gen", url: "google.com", totalSteps: 10 }, steps: [], summary: "Generates weekly marketing reports." }), status: "completed", created_at: "2024-03-08T14:45:00Z" },
        { id: 705, recording_id: 405, content: JSON.stringify({ metadata: { title: "Website Analytics Snapshot", url: "analytics.google.com", totalSteps: 4 }, steps: [], summary: "Takes a snapshot of key GA metrics." }), status: "failed", created_at: "2024-03-06T10:00:00Z" },
      ]
    },
    104: { // Igor
      4001: [ // Content & Copywriting
        { id: 803, recording_id: 503, content: JSON.stringify({ metadata: { title: "Blog Post Idea Generator", url: "google.com", totalSteps: 3 }, steps: [], summary: "Generates blog post ideas based on keywords." }), status: "completed", created_at: "2024-03-10T16:20:00Z" },
        { id: 804, recording_id: 504, content: JSON.stringify({ metadata: { title: "Ad Copy Variation Creator", url: "facebook.com", totalSteps: 6 }, steps: [], summary: "Creates variations of ad copy." }), status: "completed", created_at: "2024-03-09T13:00:00Z" },
      ],
      4002: [ // Reporting (Shared Scope Example)
        { id: 802, recording_id: 502, content: JSON.stringify({ metadata: { title: "Social Media Engagement Report", url: "buffer.com", totalSteps: 10 }, steps: [], summary: "Generates monthly social media reports." }), status: "completed", created_at: "2024-03-08T14:45:00Z" },
      ]
    },
  };

  // --- Update MOCK_USERS with scopes ---
  const MOCK_USERS: MockUser[] = [
    {
      id: 101, name: "Aleksander Müller Hildebrand", email: "amh@58mkt.com", profileImageUrl: "https://media-lga3-1.cdn.whatsapp.net/v/t61.24694-24/491835936_1349617879651271_4201915904769636793_n.jpg?ccb=11-4&oh=01_Q5Aa1QG_EToKyhazbTKhm6wpCmVAG0PaLqCEtO2bS3Mvrxn0Eg&oe=68265402&_nc_sid=5e03e0&_nc_cat=110", skills: ["Business Development", "FinOps"], focus: "Sales Ops",
      scopes: [
        { id: 1001, name: "Sales & Lead Gen", description: "Scripts for finding and managing leads.", icon: "🎯" },
        { id: 1002, name: "Financial Ops", description: "Automating invoicing and expense tasks.", icon: "💰" }
      ]
    },
    {
      id: 102, name: "Danilo Correia", email: "dan@58mkt.com", profileImageUrl: "https://media-lga3-1.cdn.whatsapp.net/v/t61.24694-24/397391836_311737671630546_7002997121643252835_n.jpg?ccb=11-4&oh=01_Q5Aa1QHfj1P-EK0FtvE7L27EV1xRBoTso55jq6Mnt-iYL8wFeA&oe=682654FD&_nc_sid=5e03e0&_nc_cat=104", skills: ["Tech", "Web Scraping", "Data Entry"], focus: "Support Tasks",
      scopes: [
        { id: 2001, name: "Web Scraping & Data Entry", description: "Extracting data and filling forms.", icon: "🕷️" },
        { id: 2002, name: "General Support", description: "Common helpdesk and support automations.", icon: "🛠️" }
      ]
    },
    {
      id: 103, name: "Felipe Duarte", email: "felipe@58mkt.com", profileImageUrl: "https://media-lga3-2.cdn.whatsapp.net/v/t61.24694-24/488821041_1198998191685686_4416303848740229190_n.jpg?ccb=11-4&oh=01_Q5Aa1QF5A-DQwUN4BXY-HNtm8FneqN_-AsKY-QTv-s9wBlod8A&oe=682635B8&_nc_sid=5e03e0&_nc_cat=102", skills: ["CRM Updates", "Report Generation"], focus: "Marketing",
      scopes: [
        { id: 3001, name: "CRM Management", description: "Keeping customer relationship data up-to-date.", icon: "👥" },
        { id: 3002, name: "Reporting", description: "Generating marketing and analytics reports.", icon: "📊" }
      ]
    },
    {
      id: 104, name: "Igor Rocha", email: "igor@58mkt.com", profileImageUrl: "https://media-lga3-2.cdn.whatsapp.net/v/t61.24694-24/470700716_1134161091649411_3283336278402845600_n.jpg?ccb=11-4&oh=01_Q5Aa1QGr80Q87gqV8XEgrJtO8mgJ85CJ86bTFe2y8UiK8SLwjQ&oe=68264E16&_nc_sid=5e03e0&_nc_cat=111", skills: ["Sales Copywriting", "Report Generation"], focus: "Marketing",
      scopes: [
        { id: 4001, name: "Content & Copywriting", description: "Automating content creation and ad copy.", icon: "✍️" },
        { id: 4002, name: "Reporting", description: "Generating marketing and analytics reports.", icon: "📊" } // Shared scope name example
      ]
    },
  ];

  // --- Check for existing Google Auth Token --- 
  useEffect(() => {
    // Try to load existing user data from storage first
    const loadUserFromStorage = async () => {
      try {
        const data = await chrome.storage.local.get(['userId', 'userName', 'userEmail', 'userProfileImageUrl']);
        if (data.userId && data.userName && data.userEmail) {
          // User data exists in storage
          console.log("Loaded user data from storage:", data);
          setCurrentUser({
            id: data.userId,
            name: data.userName,
            email: data.userEmail,
            profileImageUrl: data.userProfileImageUrl // Load profile image URL
          });
          // Still in 'authenticating' state, so the next check will proceed to 'loading'
        }
      } catch (error) {
        console.error("Failed to load user data from storage:", error);
        // Continue with normal auth flow
      }
    };

    const checkInitialAuth = () => {
      console.log("Checking for existing Google auth token...");
      // First try to load from storage, then clear tokens if needed
      if (currentUser && currentUser.id) {
        console.log("User already loaded from storage, proceeding to loading state");
        setViewState('loading');
        return;
      }

      // Clear tokens to ensure fresh authentication
      chrome.identity.clearAllCachedAuthTokens(() => {
        // Then check non-interactively
        chrome.identity.getAuthToken({ interactive: false }, (tokenResult) => {
          const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
          if (chrome.runtime.lastError || !token) {
            // Not logged in or error occurred, require interactive sign-in
            console.log(chrome.runtime.lastError?.message || "No token found non-interactively.");
            setViewState('authRequired');
          } else {
            // Token found, fetch user info and proceed
            console.log("Existing token found, fetching user info...");
            fetchUserInfoAndProceed(token as string | undefined);
          }
        });
      });
    };

    // Function to fetch user info using a token
    const fetchUserInfoAndProceed = (token: string | undefined) => {
      if (!token) {
        console.log("Token is undefined, requiring interactive sign-in.");
        setViewState('authRequired');
        return;
      }
      fetch('https://www.googleapis.com/oauth2/v1/userinfo?alt=json', {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(response => {
          if (!response.ok) throw new Error(`Google API error: ${response.status}`);
          return response.json();
        })
        .then(userInfo => {
          if (userInfo && userInfo.email) {
            console.log("Google user info fetched:", userInfo);
            // Simulate auth success to trigger backend check/session creation
            handleAuthSuccess({
              name: userInfo.name || userInfo.email,
              email: userInfo.email,
              id: null, // DB ID still unknown
              profileImageUrl: userInfo.picture
            });
          } else {
            throw new Error("Failed to retrieve valid user info from Google.");
          }
        })
        .catch(err => {
          console.error("Error fetching user info with existing token:", err);
          setErrorMessage(err.message || "Error fetching Google user info.");
          // Token might be invalid, force interactive sign-in
          chrome.identity.removeCachedAuthToken({ token: token }, () => {
            setViewState('authRequired');
          });
        });
    };

    // Only run this check once when the component mounts and state is 'authenticating'
    if (viewState === 'authenticating') {
      loadUserFromStorage();
      checkInitialAuth();
    }
  }, [viewState]);

  // --- Communication with Background Script (Recording State) --- 

  const fetchStateFromBackground = useCallback(() => {
    if (viewState !== 'loading') return; // Only fetch if we are past auth

    chrome.runtime.sendMessage({ type: "get_state" }, (response: BackgroundState | { error: string }) => {
      if (chrome.runtime.lastError) {
        console.error("Error fetching state:", chrome.runtime.lastError.message);
        setErrorMessage(`Error connecting to background: ${chrome.runtime.lastError.message}`);
        setViewState('error');
        return;
      }
      if (response && 'error' in response) {
        console.error("Error received from background:", response.error);
        setErrorMessage(`Background error: ${response.error}`);
        setViewState('error');
      } else if (response) {
        console.log("Received state from background:", response);
        setScreenshots(response.screenshots || []);
        setViewState(response.isRecording ? 'recording' : 'empty');
      } else {
        console.warn("Received empty response from background script.");
        setErrorMessage("Background script did not respond correctly.");
        setViewState('error');
      }
    });
  }, [viewState]);

  const handleConsume = useCallback(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any[]) => {
      const tabId = tabs[0]?.id as number;
      if (!tabId) return;

      chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        world: "MAIN",
        func: () => {
          const selector = [
            "a[href]",
            "button",
            'input[type="button"]',
            'input[type="submit"]',
            '[role="button"]',
            "[onclick]",
          ].join(",");
          const elems = Array.from(
            document.querySelectorAll<HTMLElement>(selector)
          );
          if (!elems.length) {
            console.warn("No clickable elements found");
            return;
          }
          const rnd = elems[Math.floor(Math.random() * elems.length)];
          const evt = new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
          });
          rnd.dispatchEvent(evt);
          console.log(
            `⚡ clicked random <${rnd.tagName.toLowerCase()}#${rnd.id}>`
          );
        },
      });
    });
  }, []);

  // Effect to fetch initial recording state and listen for updates (only runs AFTER auth)
  useEffect(() => {
    // Only proceed if authenticated and ready to load recording state
    if (viewState === 'loading') {
      fetchStateFromBackground();
    }

    const messageListener = (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      // Only process updates if we are in a post-auth state (empty or recording)
      // Important: don't auto-transition from other states like uploading or processing
      // UPDATED: Also allow update if we are in browseScripts to transition to recording
      if (viewState === 'empty' || viewState === 'recording' || viewState === 'browseScripts') {
        if (message.type === "state_update") {
          console.log("Popup received state update:", message.payload);
          const newState: BackgroundState = message.payload;
          setScreenshots(newState.screenshots || []);
          setViewState(currentState => {
            const nextViewState = newState.isRecording ? 'recording' : 'empty';
            // Avoid flicker if state hasn't actually changed
            return currentState === nextViewState ? currentState : nextViewState;
          });
        }
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      console.log("Popup closed, listener removed.");
    };
    // Dependencies: viewState ensures listener re-registers if needed, fetchState included
  }, [viewState, fetchStateFromBackground]);

  // --- Helper Functions --- 

  // Function to create a backend session

  // --- Event Handlers --- 
  const handleAuthSuccess = async (googleUserData: { name: string, email: string, id: null, profileImageUrl?: string }) => {
    console.log("Google Auth successful in parent:", googleUserData);
    setIsLoading(true); // Show loading indicator
    setErrorMessage(null);

    try {
      let dbUserId: number | null = null;

      // 1. Try fetching user from backend by email
      console.log(`Checking backend for user: ${googleUserData.email}`);
      const getUserResponse = await fetch(`${API_BASE_URL}/api/users/by-email/${encodeURIComponent(googleUserData.email)}`, {
        headers: { 'Accept': 'application/json', 'ngrok-skip-browser-warning': 'true' }
      });
      console.log("User response:", getUserResponse);
      if (getUserResponse.ok) {
        // User exists in our DB
        const existingUserData: BackendUserResponse = await getUserResponse.json();
        console.log("Existing user data fetched from backend:", existingUserData);
        dbUserId = existingUserData.id;
      } else if (getUserResponse.status === 404) {
        // User does not exist in our DB, create them
        console.log("User not found in backend, creating...");
        const createUserResponse = await fetch(`${API_BASE_URL}/api/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({
            name: googleUserData.name,
            email: googleUserData.email
          }),
        });

        if (!createUserResponse.ok) {
          const createErrorData = await createUserResponse.text();
          throw new Error(`Failed to create backend user: ${createUserResponse.status} - ${createErrorData}`);
        }

        const newUserData: BackendUserResponse = await createUserResponse.json();
        console.log("Backend user created:", newUserData);
        dbUserId = newUserData.id;

      } else {
        // Other error fetching user
        const fetchErrorData = await getUserResponse.text();
        throw new Error(`Error checking backend for user: ${getUserResponse.status} - ${fetchErrorData}`);
      }

      if (!dbUserId) {
        throw new Error("Could not determine database User ID after authentication.");
      }

      // 3. Store user details locally (including the DB ID)
      const userToStore: User = {
        id: dbUserId,
        name: googleUserData.name,
        email: googleUserData.email,
        profileImageUrl: googleUserData.profileImageUrl // Store the profile image URL
      };
      await chrome.storage.local.set({
        userId: userToStore.id,
        userName: userToStore.name,
        userEmail: userToStore.email,
        userProfileImageUrl: userToStore.profileImageUrl // Save to storage
      });
      console.log("User details saved to local storage:", userToStore);
      setCurrentUser(userToStore); // Update app state
      setViewState('loading'); // <-- Add this line to transition state

      // // 4. Create the session with the obtained DB User ID
      // await createOrGetSession(dbUserId);

    } catch (error: any) {
      console.error("Error during post-Google auth backend interaction:", error);
      setErrorMessage(`Failed to sync with backend: ${error.message}`);
      setViewState('error');
      // Optional: Clear local storage if backend sync failed?
      // await chrome.storage.local.remove(['userId', 'userName', 'userEmail']);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecordClick = async () => {
    // 1. Check Permissions first
    // const hasPermission = await checkScreenRecordingPermission();
    // if (!hasPermission) {
    //   setViewState('permissionRequired');
    //   return;
    // }

    // 2. Ensure user context is available
    if (!currentUser || currentUser.id === null) { // Check for null id
      console.error("Cannot start recording: User not properly authenticated.");
      setErrorMessage("User session invalid. Please restart the extension or log in again.");
      setViewState('error');
      return;
    }
    const currentUserId = currentUser.id; // Use the numeric ID

    console.log("Sending start_recording message to background...");
    chrome.runtime.sendMessage({ type: "start_recording" }, async (response) => {
      if (chrome.runtime.lastError || (response && response.error)) {
        const errorMsg = chrome.runtime.lastError?.message || (response as { error: string })?.error || 'Unknown background start error';
        console.error("Error starting background recording:", errorMsg);
        setErrorMessage(`Failed to start local recording: ${errorMsg}`);
        setViewState('error');
        return;
      }

      console.log("Background recording started. Creating backend recording entry...");
      setErrorMessage(null); // Clear previous errors
      setIsLoading(true); // Show loading while creating backend record

      try {
        const apiResponse = await fetch(`${API_BASE_URL}/api/recordings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({
            user_id: currentUserId, // Pass user_id
            start_time: new Date().toISOString(),
          })
        });

        const data: RecordingResponse = await apiResponse.json();
        console.log("API Recording response:", data);

        if (!apiResponse.ok) {
          throw new Error(data?.message || `API Error: ${apiResponse.status}`);
        }
        if (!data.id) {
          throw new Error("Backend did not return a recording ID.");
        }

        console.log("Backend recording created successfully. ID:", data.id);
        setRecordingId(data.id); // Store numeric ID

        // Save recording ID locally for persistence
        await chrome.storage.local.set({ currentRecordingId: data.id });
        console.log("Saved recording ID to local storage:", data.id);

        // Transition to recording view is handled by background state update listener

      } catch (apiError: any) {
        console.error("Error creating backend recording:", apiError);
        setErrorMessage(`Failed to create backend recording: ${apiError.message}`);
        setViewState('error');
        // If backend creation failed, stop the background recording?
        chrome.runtime.sendMessage({ type: "stop_recording" });
      } finally {
        setIsLoading(false);
      }
    });
  };

  const handleCancelClick = () => {
    console.log("Sending stop_recording message (Cancel)...");
    chrome.runtime.sendMessage({ type: "stop_recording" }); // Tell background to stop
    setRecordingId(null); // Clear local state
    chrome.storage.local.remove(['currentRecordingId']); // Clear storage
    // UI update to 'empty' comes via listener
  };

  const handleDoneClick = async () => {
    const currentRecordingId = recordingId;
    const finalScreenshots = [...screenshots];

    console.log(`Stopping recording, preparing upload for ID: ${currentRecordingId}...`);

    chrome.runtime.sendMessage({ type: "stop_recording" });
    setRecordingId(null);
    setScreenshots([]);
    setActionScript(null);

    if (!currentRecordingId) {
      setViewState('empty');
      return;
    }
    if (finalScreenshots.length === 0) {
      setViewState('empty');
      return;
    }

    setIsLoading(true);
    setProcessingStatusText("Uploading screenshots...");
    setViewState('processingAction');

    const formData = new FormData();
    let conversionFailures = 0;
    let uploadSucceeded = false;

    console.log("Converting screenshots...");
    for (let i = 0; i < finalScreenshots.length; i++) {
      const screenshotDataUrl = finalScreenshots[i];
      const blob = dataURLtoBlob(screenshotDataUrl);

      if (blob) {
        formData.append('files', blob, `screenshot_${i + 1}.png`);
      } else {
        conversionFailures++;
      }
    }

    if (conversionFailures > 0) {
      console.warn(`Skipped ${conversionFailures} screenshots due to conversion errors.`);
    }

    const filesToUploadCount = formData.getAll('files').length;
    if (filesToUploadCount === 0) {
      console.warn("No valid screenshots to upload after conversion.");
      setErrorMessage("Failed to process screenshots for upload.");
      setViewState('error');
      throw new Error("No valid files to upload");
    } else {
      console.log(`Uploading ${filesToUploadCount} screenshots...`);
      try {
        console.log(`Making finalize request to: ${API_BASE_URL}/api/recordings/${currentRecordingId}/finalize`);

        setProcessingStatusText("Processing recording...");

        const uploadResponse = await fetch(`${API_BASE_URL}/api/recordings/${currentRecordingId}/finalize`, {
          method: 'POST',
          headers: {
            'ngrok-skip-browser-warning': 'true'
          },
          body: formData,
        });

        console.log("Batch upload response status:", uploadResponse.status);

        if (!uploadResponse.ok) {
          let errorText = `Status: ${uploadResponse.status}`;
          try { errorText = await uploadResponse.text(); } catch { /* ignore */ }
          console.error(`Failed to upload screenshot batch. Error: ${errorText}`);
          throw new Error(`Batch upload failed: ${errorText}`);
        } else {
          setProcessingStatusText("Processing recording...");

          const responseJson: FinalizeResponse = await uploadResponse.json();
          console.log("Batch upload response JSON:", responseJson);

          if (responseJson.script && responseJson.script.content) {
            console.log("Script received, parsing and setting detail view state.");
            setProcessingStatusText("Loading script details...");

            try {
              const parsedContent: ParsedScript | null = JSON.parse(responseJson.script.content);
              if (parsedContent) {
                const newScriptDetail: ParsedScript = {
                  ...parsedContent,
                  id: responseJson.script.id,
                  rawContent: responseJson.script.content
                };
                setSelectedScriptDetail(newScriptDetail); // Set the newly generated script data
                setViewState('scriptDetail'); // Navigate to the detail view
                uploadSucceeded = true;
              } else {
                throw new Error("Parsed script content is null or invalid.");
              }
            } catch (parseError) {
              console.error("Failed to parse newly generated script content:", parseError);
              setErrorMessage(`Recording processed, but failed to display script: ${parseError instanceof Error ? parseError.message : 'Unknown parsing error'}`);
              setViewState('error'); // Go to error state if parsing fails
            }
          } else {
            console.warn("Upload succeeded, but no valid script content found in response.");
            setErrorMessage("Processing complete, but failed to retrieve action script content.");
            setViewState('error');
          }
        }
      } catch (uploadError: any) {
        console.error(`Processing error:`, uploadError);
        setErrorMessage(uploadError.message || "An unknown error occurred during processing.");
        setViewState('error');
      } finally {
        setIsLoading(false);
        // State is now set explicitly within try/catch blocks for success/failure
        // No need to set state here unless there's a fallback needed
      }
    }
  };

  // Add a function to fetch scripts based on mode
  const fetchScripts = useCallback(async () => {
    // Fetches the *current logged-in user's* scripts
    if (!currentUser || !currentUser.id) {
      console.error("Cannot fetch user scripts: User ID not available.");
      setErrorMessage("User information is missing.");
      setViewState('error');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setScripts([]); // Clear existing scripts
    const url = `${API_BASE_URL}/api/scripts?user_id=${currentUser.id}`;
    console.log("Fetching user scripts:", url);

    try {
      const response = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'ngrok-skip-browser-warning': 'true'
        }
      });
      if (!response.ok) throw new Error(`Failed to fetch user scripts: ${response.status} ${response.statusText}`);
      const data = await response.json();
      setScripts(data);
    } catch (error) {
      console.error("Error fetching user scripts:", error);
      setErrorMessage(`Failed to load your scripts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setViewState('error'); // Go to error state, but maybe allow retry?
    } finally {
      setIsLoading(false);
    }
  }, [API_BASE_URL, currentUser]);

  // Mock function to fetch marketplace users
  const fetchMarketplaceUsers = useCallback(async () => {
    console.log("Fetching marketplace users (mocked)...", MOCK_USERS);
    setIsLoading(true);
    setErrorMessage(null);
    setMarketplaceUsers([]); // Clear existing users
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
    setMarketplaceUsers(MOCK_USERS);
    setIsLoading(false);
  }, []);

  // Mock function to fetch scripts for a selected marketplace user
  const fetchScriptsForMarketplaceUser = useCallback(async (userId: number) => {
    console.log(`Fetching scripts for marketplace user ${userId} (mocked)...`);
    setIsLoading(true);
    setErrorMessage(null);
    setScripts([]); // Clear existing scripts
    await new Promise(resolve => setTimeout(resolve, 500)); // Simulate delay
    const userScripts = MOCK_SCOPED_SCRIPTS[userId] || {};
    const scripts = Object.values(userScripts).flat();
    setScripts(scripts);
    setIsLoading(false);
  }, []);

  // Fetch data when entering the loading state based on mode
  useEffect(() => {
    if (viewState === 'loadingScripts') {
      let fetchPromise;
      if (scriptViewMode === 'user') {
        console.log("useEffect: Fetching user scripts");
        fetchPromise = fetchScripts();
      } else { // marketplace mode
        if (selectedMarketplaceUser) {
          console.log(`useEffect: Fetching scripts for marketplace user ${selectedMarketplaceUser.id}`);
          fetchPromise = fetchScriptsForMarketplaceUser(selectedMarketplaceUser.id);
        } else {
          console.log("useEffect: Fetching marketplace users");
          fetchPromise = fetchMarketplaceUsers();
        }
      }

      fetchPromise.finally(() => {
        // Only transition to browse view AFTER fetch completes (or fails)
        if (viewState === 'loadingScripts') { // Check state hasn't changed again
          setViewState('browseScripts');
        }
      });
    }
  }, [viewState, scriptViewMode, selectedMarketplaceUser, fetchScripts, fetchMarketplaceUsers, fetchScriptsForMarketplaceUser]);

  // --- Filtering Logic ---
  const filteredScripts = useMemo(() => {
    if (!searchQuery) {
      return scripts; // No search query, return all fetched scripts
    }
    const lowerCaseQuery = searchQuery.toLowerCase();
    return scripts.filter(script => {
      try {
        // Attempt to parse title from content for filtering
        const parsed = JSON.parse(script.content);
        const title = parsed?.metadata?.title || '';
        return title.toLowerCase().includes(lowerCaseQuery);
      } catch (e) {
        // If parsing fails, maybe filter based on raw content or skip
        // return script.content.toLowerCase().includes(lowerCaseQuery);
        return false; // Skip scripts with unparseable content for simplicity
      }
    });
  }, [scripts, searchQuery]);

  // --- Button Handlers ---
  const handleMarketplaceUserSelect = (user: MockUser) => {
    console.log("Selected marketplace user:", user.name);
    setSelectedMarketplaceUser(user);
    setSearchQuery(''); // Clear search when selecting a user
    setViewState('loadingScripts'); // Trigger fetch for this user's scripts
  };

  // Navigate to script loading state (initial view is user scripts)
  const handleBrowseScriptsClick = () => {
    setScriptViewMode('user'); // Default to user scripts
    setSearchQuery(''); // Clear search
    setViewState('loadingScripts');
  };

  // Handler for My Scripts button click (to return from marketplace user list OR specific user scripts)
  const handleShowMyScriptsClick = () => {
    setScriptViewMode('user');
    setSearchQuery(''); // Clear search
    setSelectedMarketplaceUser(null); // Clear selected user
    setViewState('loadingScripts'); // Trigger fetch for user scripts
  };

  // Handler for Marketplace button click (from user scripts view OR from specific user script view)
  const handleMarketplaceClick = () => {
    setScriptViewMode('marketplace');
    setSelectedMarketplaceUser(null); // Go back to the user list view
    setSearchQuery('');
    setViewState('loadingScripts'); // Trigger fetch for marketplace users
  };

  // Handle search input change
  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
  };

  // Handle clicking a script card in the list
  const handleScriptSelect = (script: Script) => {
    try {
      const parsedContent: ParsedScript | null = JSON.parse(script.content);
      if (parsedContent) {
        // Add the original script ID to the parsed object
        const scriptWithId: ParsedScript = {
          ...parsedContent,
          id: script.id,
          rawContent: script.content // Optionally keep raw content
        };
        setSelectedScriptDetail(scriptWithId); // Set the parsed script for detail view
        setViewState('scriptDetail'); // Change the view state
      } else {
        throw new Error("Parsed content is null or invalid.");
      }
    } catch (e) {
      console.error("Failed to parse script content on select:", e);
      // Handle parsing error - maybe show an unparsed view or an error
      setErrorMessage(`Failed to load script details: ${e instanceof Error ? e.message : 'Unknown parsing error'}`);
      // Fallback: Create a minimal ParsedScript object to show something
      setSelectedScriptDetail({
        id: script.id,
        metadata: { title: `Script ${script.id} (Error)`, url: "", totalSteps: 0 },
        steps: [],
        summary: "Could not parse script content.",
        rawContent: script.content
      });
      setViewState('scriptDetail'); // Still go to detail view, but show error state within it potentially
    }
  };

  // Handle back navigation
  const handleBackNavigation = () => {
    // Simple back logic: from detail go to list, from list go to empty
    if (viewState === 'scriptDetail') {
      setSelectedScriptDetail(null);
      setViewState('loadingScripts'); // Go to loading state to refetch scripts
    } else if (viewState === 'browseScripts') {
      setViewState('empty');
    } else {
      // Default back action if needed, e.g., from error state
      setViewState('empty');
    }
  };

  // Check if back button should be shown
  const showBackButton = ['browseScripts', 'scriptDetail', 'error', 'permissionRequired'].includes(viewState);

  // Determine if the body should be centered
  const isBodyCentered = !['browseScripts', 'scriptDetail', 'recording'].includes(viewState);

  // Function to handle script runs - add this where it makes sense in the component
  const handleScriptRun = (script: ParsedScript, context?: string) => {
    console.log("Script run from main component:", script.metadata.title, context);
    // Here you could add analytics, history tracking, etc.
  };

  // Handler for Permission Guide confirmation
  const handlePermissionConfirmed = async () => {
    const hasPermission = await checkScreenRecordingPermission();
    if (hasPermission) {
      setViewState('empty'); // Permission granted, go to main view
    } else {
      // Still no permission, maybe show error or keep guide visible
      setErrorMessage("Screen recording permission is still required.");
      // Optionally stay on 'permissionRequired' or go to 'error'
    }
  };

  // --- Screen Recording Permission Check ---
  async function checkScreenRecordingPermission(): Promise<boolean> {
    if (!('mediaDevices' in navigator && 'getDisplayMedia' in navigator.mediaDevices)) {
      console.warn("getDisplayMedia API not supported.");
      return false; // Cannot check if API is unavailable
    }
    try {
      // Try to get display media stream without capturing it
      // This often triggers the permission prompt or fails if denied
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      // Immediately stop the tracks if successful to avoid actual recording
      stream.getTracks().forEach(track => track.stop());
      console.log("Screen recording permission seems granted.");
      return true;
    } catch (err: any) {
      // DOMException: NotAllowedError - User denied permission
      // DOMException: NotFoundError - No screen found (less likely for permission check)
      // Other errors might occur
      if (err.name === 'NotAllowedError') {
        console.warn("Screen recording permission denied by user.");
      } else {
        console.error("Error checking screen recording permission:", err);
      }
      return false;
    }
  }

  // --- User Menu Handlers ---
  const toggleUserMenu = () => {
    setIsUserMenuOpen(!isUserMenuOpen);
  };

  const handleLogout = async () => {
    console.log("Logging out...");
    setIsUserMenuOpen(false); // Close menu
    try {
      // 1. Get the current token to revoke it
      chrome.identity.getAuthToken({ interactive: false }, (tokenResult) => {
        const token = typeof tokenResult === 'string' ? tokenResult : tokenResult?.token;
        if (token) {
          // 2. Revoke the token
          // Note: fetch is needed to invalidate server-side, but revoke removes local cache
          fetch('https://accounts.google.com/o/oauth2/revoke?token=' + token);
          chrome.identity.removeCachedAuthToken({ token: token }, () => {
            console.log("Google token revoked and removed from cache.");
          });
        } else {
          console.log("No active token found to revoke.");
        }
      });

      // 3. Clear user data from local storage
      await chrome.storage.local.remove(['userId', 'userName', 'userEmail']);
      console.log("User details removed from local storage.");

      // 4. Reset component state
      setCurrentUser(null);
      setViewState('authRequired'); // Go back to auth view

    } catch (error) {
      console.error("Error during logout:", error);
      setErrorMessage("Logout failed. Please try again.");
      // Optionally reset state even on error?
      setCurrentUser(null);
      setViewState('authRequired');
    }
  };

  // Placeholder handlers for other menu items
  const handleSettingsClick = () => {
    console.log("Settings clicked (not implemented)");
    setIsUserMenuOpen(false);
    // Implement navigation or modal logic here
  };

  const handleAboutClick = () => {
    console.log("About Atlas clicked (not implemented)");
    setIsUserMenuOpen(false);
    // Implement navigation or modal logic here
  };

  return (
    <div className="app">
      <header className="app__header">
        {showBackButton ? (
          <button onClick={handleBackNavigation} className="icon-button back-button" title="Back">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
        ) : (
          // Add a placeholder div with the same width as the back button when it's not shown
          <div className="header-placeholder"></div>
        )}
        <div className="app-title-wrapper">
          <span className="app-title-text">🚜 Atlas - Automate Boring Stuff</span>
        </div>
        {errorMessage && !showBackButton && <span className="error-indicator">Error!</span>}

        {currentUser && (
          <div className="user-profile-container">
            <button onClick={toggleUserMenu} className="user-profile-button">
              {currentUser.profileImageUrl ? (
                <img
                  src={currentUser.profileImageUrl}
                  alt={`${currentUser.name}'s profile`}
                  className="user-profile-image"
                />
              ) : (
                <span className="user-initial">{currentUser.name ? currentUser.name[0].toUpperCase() : 'U'}</span>
              )}
            </button>

            {isUserMenuOpen && (
              <motion.div
                className="user-menu"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="user-menu-header">
                  Signed in as<br />
                  <strong>{currentUser.email}</strong>
                </div>
                <ul className="user-menu-list">
                  <li className="user-menu-item" onClick={handleSettingsClick}>Settings</li>
                  <li className="user-menu-item" onClick={handleAboutClick}>About Atlas</li>
                  <li className="user-menu-item user-menu-item--logout" onClick={handleLogout}>Logout</li>
                </ul>
              </motion.div>
            )}
          </div>
        )}
      </header>
      <div className={`app__body ${isBodyCentered ? 'app__body--centered' : ''}`}>
        {viewState !== 'error' && errorMessage && showBackButton && (
          <p className="error-message-inline">Error: {errorMessage}</p>
        )}
        <AnimatePresence mode="wait">
          {viewState === 'authenticating' && (
            <motion.div key="authenticating" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center' }}>
              Authenticating...
            </motion.div>
          )}
          {viewState === 'authRequired' && (
            <AuthView
              key="auth"
              baseUrl={API_BASE_URL}
              onAuthSuccess={handleAuthSuccess}
            />
          )}
          {viewState === 'loading' && !isLoading && (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center' }}>
              Loading recording state...
            </motion.div>
          )}
          {viewState === 'loadingScripts' && (
            <LoadingView key="loading-scripts" statusText="Loading scripts..." />
          )}
          {viewState === 'processingAction' && (
            <LoadingView
              key="processing"
              statusText={processingStatusText || "Processing..."}
            />
          )}
          {viewState === 'empty' && (
            <EmptyView
              key="empty"
              onRecordClick={handleRecordClick}
              onBrowseScriptsClick={handleBrowseScriptsClick}
              disabled={isLoading}
            />
          )}
          {viewState === 'recording' && (
            <RecordingView
              key="recording"
              screenshots={screenshots}
              onCancelClick={handleCancelClick}
              onDoneClick={handleDoneClick}
            />
          )}
          {viewState === 'scriptDetail' && selectedScriptDetail && (
            <ScriptDetailsView
              key="detail"
              script={selectedScriptDetail}
              onBack={handleBackNavigation}
              onRun={handleScriptRun}
            />
          )}
          {viewState === 'permissionRequired' && (
            <PermissionGuideView
              key="permission"
              onConfirm={handlePermissionConfirmed}
            />
          )}
          {viewState === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ textAlign: 'center', color: 'red' }}>
              <p>An error occurred:</p>
              <p>{errorMessage || 'An unknown error occurred.'}</p>
              <button
                className="button button--secondary"
                onClick={() => {
                  setErrorMessage(null);
                  setViewState('authenticating');
                }}
                style={{ marginTop: '1rem' }}
              >
                Retry
              </button>
            </motion.div>
          )}
          {viewState === 'browseScripts' && (
            <>
              {scriptViewMode === 'marketplace' && !selectedMarketplaceUser ? (
                <MarketplaceUserListView
                  key="marketplace-users"
                  users={marketplaceUsers}
                  onUserSelect={handleMarketplaceUserSelect}
                  onShowMyScriptsClick={handleShowMyScriptsClick}
                  searchQuery={searchQuery}
                  onSearchChange={handleSearchChange}
                />
              ) : (
                <ShowScriptsView
                  key={`browse-${scriptViewMode}-${selectedMarketplaceUser?.id || 'user'}`}
                  scripts={filteredScripts}
                  onBack={handleBackNavigation} // Back always goes to initial empty view from list?
                  onNewScriptClick={scriptViewMode === 'user' ? handleRecordClick : undefined} // Only allow new script from user view
                  onScriptSelect={handleScriptSelect}
                  scriptViewMode={scriptViewMode}
                  searchQuery={searchQuery}
                  onMarketplaceClick={handleMarketplaceClick} // Handles going to marketplace / back to user list
                  onShowMyScriptsClick={handleShowMyScriptsClick} // Only relevant visually in this component, handled above
                  onSearchChange={handleSearchChange}
                />
              )}
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
