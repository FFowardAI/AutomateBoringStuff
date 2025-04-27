import React, { useState } from "react";

// defines the shape of a single action returned by Claude
type Action =
    | { tool: "click"; selector: string }
    | { tool: "navigate"; url: string };

// Function to check for restricted URLs
function isRestrictedUrl(url?: string): boolean {
    if (!url) return true; // No URL, assume restricted
    return url.startsWith('chrome://') ||
        url.startsWith('chrome-extension://') ||
        url.startsWith('https://chrome.google.com/webstore') ||
        url.startsWith('about:');
}

// Function to simplify DOM HTML to reduce token count
function simplifyDomHtml(html: string): string {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Remove script tags
        const scripts = doc.querySelectorAll('script');
        scripts.forEach(script => script.remove());

        // Remove style tags
        const styles = doc.querySelectorAll('style');
        styles.forEach(style => style.remove());

        // Remove svg elements (often large and unnecessary)
        const svgs = doc.querySelectorAll('svg');
        svgs.forEach(svg => svg.remove());

        // Remove data attributes
        const allElements = doc.querySelectorAll('*');
        allElements.forEach(el => {
            Array.from(el.attributes).forEach(attr => {
                if (attr.name.startsWith('data-')) {
                    el.removeAttribute(attr.name);
                }
            });
        });

        // Remove comments
        const nodeIterator = document.createNodeIterator(
            doc,
            NodeFilter.SHOW_COMMENT
        );
        let currentNode;
        const commentsToRemove = [];
        while (currentNode = nodeIterator.nextNode()) {
            commentsToRemove.push(currentNode);
        }
        commentsToRemove.forEach(comment => comment.parentNode?.removeChild(comment));

        // Get the simplified HTML
        let simplifiedHtml = doc.documentElement.outerHTML;

        // Limit overall size if still too large (100KB limit is reasonable)
        const MAX_SIZE = 100 * 1024; // 100KB
        if (simplifiedHtml.length > MAX_SIZE) {
            simplifiedHtml = simplifiedHtml.substring(0, MAX_SIZE) + '<!-- HTML truncated due to size -->';
            console.log(`HTML was too large (${simplifiedHtml.length} bytes) and was truncated to ${MAX_SIZE} bytes`);
        }

        return simplifiedHtml;
    } catch (error) {
        console.error("Error simplifying DOM HTML:", error);
        // If simplification fails, truncate the raw HTML as a fallback
        const MAX_SIZE = 50 * 1024; // 50KB as fallback size
        if (html.length > MAX_SIZE) {
            return html.substring(0, MAX_SIZE) + '<!-- HTML truncated due to size -->';
        }
        return html;
    }
}

// Extract just the important interactive elements for navigation
function extractInteractiveElements(html: string): string {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Create a new document for our simplified version
        const newDoc = document.implementation.createHTMLDocument();
        const body = newDoc.body;

        // Get the title
        const titleEl = document.createElement('h1');
        titleEl.textContent = doc.title;
        body.appendChild(titleEl);

        // Extract key interactive elements
        const interactiveSelectors = [
            'a[href]',
            'button',
            'input:not([type="hidden"])',
            'select',
            'textarea',
            'form',
            '[role="button"]',
            '[role="link"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[onclick]'
        ];

        // Create a list of elements
        const elementsList = document.createElement('ul');
        body.appendChild(elementsList);

        // Find all interactive elements
        const elements = doc.querySelectorAll(interactiveSelectors.join(','));
        elements.forEach(el => {
            // Create an item for this element
            const item = document.createElement('li');

            // Create a simplified representation
            let description = el.tagName.toLowerCase();
            if (el.id) description += `#${el.id}`;
            if (el.className) description += `.${el.className.split(' ').join('.')}`;

            // Add text content if it has any
            if (el.textContent?.trim()) {
                description += `: "${el.textContent.trim().substring(0, 50)}"`;
                if (el.textContent.trim().length > 50) description += '...';
            }

            // For links, include href
            if (el.tagName === 'A' && el.hasAttribute('href')) {
                description += ` - ${el.getAttribute('href')}`;
            }

            // For inputs, include type and placeholder
            if (el.tagName === 'INPUT') {
                description += ` (type=${el.getAttribute('type') || 'text'})`;
                if (el.hasAttribute('placeholder')) {
                    description += ` placeholder="${el.getAttribute('placeholder')}"`;
                }
            }

            item.textContent = description;
            elementsList.appendChild(item);
        });

        return newDoc.documentElement.outerHTML;
    } catch (error) {
        console.error("Error extracting interactive elements:", error);
        return "Error extracting elements from page";
    }
}

interface AutoActionViewProps {
    markdown: string;
    onShowAllScripts?: () => void; // New prop to handle showing all scripts
}

export const AutoActionView: React.FC<AutoActionViewProps> = ({
    markdown,
    onShowAllScripts
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleStart = async () => {
        setError(null);
        setLoading(true);
        try {
            // 1. Get the active tab
            const [tab] = await chrome.tabs.query({
                active: true,
                currentWindow: true,
            });

            // --- Check for restricted URL --- 
            if (!tab || !tab.id || isRestrictedUrl(tab.url)) {
                throw new Error("Cannot run action on the current page (e.g., chrome:// pages, extension pages, web store).");
            }
            // --- End Check ---

            // 2. Grab the current page DOM.
            console.log("Grabbing DOM from tab:", tab.id);
            const [{ result: domHtml }] = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => document.documentElement.outerHTML,
            });

            if (!domHtml) {
                console.warn("Could not retrieve DOM HTML from the page.");
                // Decide if this is a fatal error or if we can proceed without DOM
                // throw new Error("Failed to get page content.");
            }

            // Get page title and URL for context
            const pageContext = {
                url: tab.url || 'unknown',
                title: tab.title || 'unknown'
            };

            console.log("DOM HTML size before processing:", domHtml?.length || 0);

            // Process DOM to avoid token limit issues
            const processedDom = domHtml ? extractInteractiveElements(domHtml) : "";

            console.log("DOM HTML size after processing:", processedDom.length);

            // 3. Make the HTTP request to our local server endpoint for Anthropic.
            console.log("Sending request to backend...");
            const resp = await fetch("https://31ca-4-39-199-2.ngrok-free.app/api/computer-use/function-call", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    'ngrok-skip-browser-warning': 'true', // ngrok warning header
                },
                body: JSON.stringify({
                    markdown,
                    domHtml: processedDom, // Send processed DOM HTML
                    pageContext, // Send additional context about the page
                    instruction: ``  // add instruction if needed
                }),
            });

            console.log("Claude response status:", resp.status);

            if (!resp.ok) {
                throw new Error(`Server error: ${resp.status} ${await resp.text()}`);
            }

            const data = await resp.json();

            console.log("Claude response data:", data);

            // 4. Execute the action based on the response
            const toolCall = data?.toolCall // Adjust based on actual response structure
            if (!toolCall || !toolCall.name) {
                throw new Error("Invalid or missing tool call in the response from the server.");
            }

            console.log("Executing Tool call:", toolCall);

            if (toolCall.name === "click") {
                const selector = toolCall.input?.selector; // Adjust based on actual structure
                if (!selector) {
                    throw new Error("Missing selector for 'click' action");
                }
                console.log(`Executing click on selector: ${selector}`);
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id! },
                    func: (sel: string) => {
                        try {
                            const el = document.querySelector(sel) as HTMLElement | null;
                            if (el) {
                                console.log('Clicking element:', el);
                                el.click();
                            } else {
                                console.error('Element not found for selector:', sel);
                            }
                        } catch (e) {
                            console.error(`Error clicking selector ${sel}:`, e)
                        }
                    },
                    args: [selector],
                });
            } else if (toolCall.name === "navigate") {
                const url = toolCall.input?.url; // Adjust based on actual structure
                if (!url) {
                    throw new Error("Missing URL for 'navigate' action");
                }
                console.log(`Navigating to URL: ${url}`);
                await chrome.tabs.update(tab.id!, { url: url });
            } else {
                throw new Error(`Unknown tool action received: ${toolCall.name}`);
            }

            console.log("Action executed successfully.");

        } catch (e: any) {
            console.error("Error in handleStart:", e);
            setError(e.message || "An unknown error occurred");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: "1rem" }}>
            <h4>Auto‑Action Runner</h4>
            <textarea
                value={markdown}
                placeholder="Paste your markdown todo list here…"
                style={{ width: "100%", height: 120 }}
                readOnly
            />
            <div style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "1rem"
            }}>
                <button
                    className="button button--primary"
                    onClick={handleStart}
                    disabled={loading || !markdown || typeof markdown !== 'string' || !markdown.trim()}
                >
                    {loading ? "Running…" : "Run First Step"}
                </button>

                {onShowAllScripts && (
                    <button
                        className="button button--secondary"
                        onClick={onShowAllScripts}
                        disabled={loading}
                    >
                        Show All Scripts
                    </button>
                )}
            </div>
            {loading && (
                <div style={{
                    marginTop: "1rem",
                    padding: "0.5rem",
                    backgroundColor: "#f8f9fa",
                    borderRadius: "4px",
                    textAlign: "center"
                }}>
                    <p>Processing page content and executing automation...</p>
                </div>
            )}
            {error && <p style={{ color: "red", marginTop: "0.5rem" }}>Error: {error}</p>}
        </div>
    );
};