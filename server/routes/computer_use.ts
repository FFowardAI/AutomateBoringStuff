import { Router, Context } from "oak";
// Removed SDK import: import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai"; 
import { estimateGeminiTokens } from "../utils/token_estimator.ts";

const router = new Router();
// Update API URL placeholder (actual SDK usage might differ)
// const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const GOOGLE_API_KEY = Deno.env.get("GOOGLE_API_KEY"); // Use Google API Key
const MODEL = "gemini-1.5-pro-latest"; // Update to Gemini 1.5 Pro
// Define Gemini REST API endpoint
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

// Tool definitions adapted for Gemini FunctionDeclarationSchema
const tools = [
    {
        functionDeclarations: [
            {
                name: "click",
                description: "Click on an element specified by a CSS selector.",
                parameters: {
                    type: "OBJECT", // Use uppercase OBJECT for Gemini
                    properties: {
                        selector: { // Changed from coordinates to selector
                            type: "STRING",
                            description: "CSS selector for the element to click."
                        },
                        // Removed coordinates
                        // Removed screenshotDimensions (handled by analysis)
                        // Removed url (part of navigate tool)
                    },
                    required: ["selector"] // Require selector
                }
            },
            {
                name: "navigate",
                description: "Navigate to a URL",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        url: {
                            type: "STRING",
                            description: "URL to navigate to"
                        }
                    },
                    required: ["url"]
                }
            },
            {
                name: "type",
                description: "Type text into the currently focused element, or a specified element.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        text: {
                            type: "STRING",
                            description: "Text to type"
                        },
                        selector: { // Added optional selector for targeting
                            type: "STRING",
                            description: "(Optional) CSS selector for the input element. If omitted, uses the currently focused element."
                        },
                        submitForm: {
                            type: "BOOLEAN", // Use uppercase BOOLEAN
                            description: "Whether to submit the form after typing (simulates pressing Enter)"
                        }
                    },
                    required: ["text"]
                }
            },
            { // Added a tool for completion
                name: "task_complete",
                description: "Call this function when the requested task or step is successfully completed.",
                parameters: {
                    type: "OBJECT",
                    properties: {
                        message: {
                            type: "STRING",
                            description: "A message confirming the task completion and summarizing the result."
                        }
                    },
                    required: ["message"]
                }
            }
        ]
    }
];

// Main endpoint for computer use function calling
router.post("/function-call", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();
        const {
            markdown,
            screenshot,
            instruction,
            previousAction = "",
            stepContext = "",
            successState = true,
            completionIndicator = false,
            html = "" // Added html parameter
        } = body;

        // Get the API key from environment variable
        // const apiKey = Deno.env.get("ANTHROPIC_API_KEY"); // Removed Anthropic key
        if (!GOOGLE_API_KEY) { // Check for Gemini key
            ctx.response.status = 500;
            ctx.response.body = { error: "Missing GOOGLE_API_KEY environment variable" };
            return;
        }

        // Updated prompt for Gemini, emphasizing HTML and task_complete tool
        const systemPrompt = "You are an AI assistant controlling a web browser based on user instructions, screenshots, and HTML content. " +
            "You have the following tools available:\n" +
            "1) click(selector: string): Clicks an element using a CSS selector derived from the HTML.\n" +
            "2) navigate(url: string): Navigates the browser to a specified URL.\n" +
            "3) type(text: string, selector?: string, submitForm?: boolean): Types text. If selector is provided, it clicks that element first. Otherwise, types into the currently focused element. `submitForm` simulates Enter.\n" +
            "4) task_complete(message: string): Call this ONLY when the specific step's objective is fully achieved. The message should confirm success.\n\n" +
            "Your goal is to execute the user's multi-step instruction accurately. Analyze the provided screenshot AND HTML content to understand the page structure and identify the correct elements for interaction. Generate precise CSS selectors for clicks and typing.\n\n" +
            "IMPORTANT INSTRUCTIONS:\n" +
            "- Base your actions primarily on the HTML structure. Use the screenshot for visual context and confirmation.\n" +
            "- Always provide a CSS selector for the `click` tool.\n" +
            "- For `type`, if the target input isn't focused, provide its selector.\n" +
            "- If a previous action failed, analyze the error and the current state (HTML, screenshot) to devise an alternative approach.\n" +
            "- When the objective of the current step (described in 'stepContext') is met, DO NOT call any more action tools (`click`, `navigate`, `type`). Instead, call `task_complete` with a confirmation message.\n" +
            "- Respond ONLY with a function call. Do not add explanatory text before or after the function call JSON.";

        const userMessageContent = [
            { type: "text", text: `Instruction: ${markdown}` },
            { type: "text", text: `Current Screenshot Analysis Context:` },
            {
                type: "image",
                source: {
                    type: "base64",
                    media_type: "image/png",
                    data: screenshot.replace(/^data:image\/png;base64,/, "")
                }
            },
            { type: "text", text: `Current Page HTML (use this for selectors): \n\`\`\`html\n${html}\n\`\`\`` }, // Include HTML
            { type: "text", text: `Additional Context: ${instruction}` }, // Screen size etc.
            ...(previousAction ? [{ type: "text", text: `Previous action attempted: ${previousAction}. It ${successState ? 'succeeded' : 'failed'}.` }] : []),
            ...(stepContext ? [{ type: "text", text: `Current step context: ${stepContext}` }] : []),
            ...(completionIndicator ? [{ type: "text", text: "NOTE: Multiple successful actions occurred. If the step's goal is met, call task_complete." }] : [])
        ];

        const requestPayload = {
            contents: [
                // Gemini prefers system instructions potentially within the main contents or via system_instruction field
                { role: "user", parts: [{ text: systemPrompt }] }, // Simple approach: add system prompt as user text
                { role: "model", parts: [{ text: "Okay, I understand the instructions. I will analyze the HTML and screenshot to perform the requested action and call task_complete when the step is done. I will only respond with a function call." }] }, // Start conversation
                {
                    role: "user", parts: userMessageContent.map(item => {
                        if (item.type === 'image' && item.source && item.source.media_type && item.source.data) {
                            return { inline_data: { mime_type: item.source.media_type, data: item.source.data } };
                        } else if (item.text) {
                            return { text: item.text };
                        } else {
                            // Fallback for any unexpected item format
                            return { text: "Unsupported content format" };
                        }
                    })
                }
            ],
            tools: tools, // Use the Gemini-formatted tools
            // Optional: Add safety settings if needed
            // safetySettings: [
            //     { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE }
            // ]
        };

        // Use the modular token estimator
        const tokenEstimation = estimateGeminiTokens({
            systemPrompt,
            screenshot,
            html,
            markdown,
            instruction,
            previousAction,
            stepContext
        });

        // Log the token estimates
        tokenEstimation.logEstimates();

        // Simple input size logging
        const requestPayloadString = JSON.stringify(requestPayload);
        console.log(`=== INPUT SIZE METRICS ===`);
        console.log(`HTML size: ${(html.length / 1024).toFixed(2)} KB`);
        console.log(`Total request payload: ${(requestPayloadString.length / 1024).toFixed(2)} KB`);
        console.log(`=========================`);

        const response = await fetch(GEMINI_API_URL, { // Use Gemini URL
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // "x-api-key": apiKey, // Removed Anthropic header
                // "anthropic-version": "2023-06-01" // Removed Anthropic header
            },
            body: JSON.stringify(requestPayload), // Use the Gemini payload structure
        });

        if (!response.ok) {
            const errorText = await response.text();
            ctx.response.status = response.status;
            ctx.response.body = { error: `Gemini API error: ${response.status} ${errorText}` };
            return;
        }

        const data = await response.json();

        // Extract tool call or text message from Gemini response
        let toolCall: { name: string; input: object } | null = null;
        let message = "";

        // Gemini response structure is different
        const candidate = data?.candidates?.[0];
        if (candidate?.content?.parts) {
            for (const part of candidate.content.parts) {
                if (part.functionCall) {
                    toolCall = {
                        name: part.functionCall.name,
                        // Gemini uses 'args' for input
                        input: part.functionCall.args || {}
                    };
                    // If task_complete is called, extract the message
                    if (toolCall.name === 'task_complete' && toolCall.input && typeof toolCall.input === 'object' && 'message' in toolCall.input) {
                        message = (toolCall.input as { message: string }).message;
                        // Don't send the task_complete call itself, just the message
                        toolCall = null;
                    }
                    break; // Expecting one tool call or one text message
                } else if (part.text) {
                    // If Gemini responds with text instead of a tool call (e.g., for clarification or error)
                    message += part.text;
                }
            }
        }

        // If no tool call was generated but also no completion message, check finish reason
        if (!toolCall && !message && candidate?.finishReason && candidate.finishReason !== 'STOP' && candidate.finishReason !== 'TOOL_CALL') {
            console.warn("Gemini finish reason:", candidate.finishReason, candidate.safetyRatings);
            message = `Model finished unexpectedly (${candidate.finishReason}). Check logs.`;
            // Potentially set error state or attempt recovery?
        }

        ctx.response.body = {
            toolCall, // This will be null if task_complete was called or text response received
            message: message.trim() || (toolCall ? "" : "No message or tool call provided by the model") // Provide message only if no tool call active
        };

    } catch (err) {
        const error = err as Error;
        console.error("Error calling Gemini API:", error);
        ctx.response.status = 500;
        ctx.response.body = { error: error.message || "Unknown error" };
    }
});

// Endpoint to handle tool result and continue conversation - REMOVED as Gemini handles this differently
/*
router.post("/tool-result", async (ctx: Context) => {
    // ... entire endpoint removed ...
});
*/

export default router;
