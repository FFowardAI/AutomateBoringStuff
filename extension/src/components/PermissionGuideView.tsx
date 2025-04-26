import React from 'react';
import { motion } from 'framer-motion';

// Use chrome.runtime.getURL to get the correct path within the extension
const imageRelativePath = '/images/permissionsTutorial.png';
let screenshotPath = imageRelativePath; // Default fallback
try {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    screenshotPath = chrome.runtime.getURL(imageRelativePath);
    console.log("Resolved screenshot path:", screenshotPath); // Log the resolved path
  }
} catch (e) {
  console.error("Error resolving image path with chrome.runtime.getURL:", e);
}

interface PermissionGuideViewProps {
  onConfirm: () => void; // Function to call when user confirms permission is granted
}

export const PermissionGuideView: React.FC<PermissionGuideViewProps> = ({ onConfirm }) => {
  return (
    <motion.div
      key="permission"
      className="permission-guide-state" // Add a specific class for styling
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <h3 className="permission-title">Screen Recording Permission Needed</h3>
      <p className="permission-text">
        To record your screen, please grant permission in macOS System Settings.
        Go to <strong>System Settings &gt; Privacy & Security &gt; Screen Recording</strong>
        and ensure your browser (e.g., Chrome) is checked.
      </p>
      <img 
        src={screenshotPath} 
        alt="macOS Screen Recording Permission Setting" 
        className="permission-screenshot"
      />
      <p className="permission-text">
        After enabling permission, you might need to restart your browser for the change to take effect.
      </p>
      <button className="button button--primary" onClick={onConfirm}>
        I have enabled Screen Recording
      </button>
    </motion.div>
  );
}; 