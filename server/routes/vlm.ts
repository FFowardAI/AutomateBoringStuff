import { Router, Context } from "oak";
import { supabase, supabaseUrl } from "../db/supabaseClient.ts";
import { generateOrUpdateScript } from "../utils/anthropicUtils.ts";

// Define a helper type that includes the params property
type RouterContext = Context & {
    params: {
        [key: string]: string;
    };
};

const router = new Router();
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-7-sonnet-latest";

// Default prompt for automating tasks based on image sequences
const DEFAULT_AUTOMATION_PROMPT = `
Analyze these screenshots of a workflow or task and create a detailed automation script in JSON format.
For each step shown in the images (ordered chronologically):
1. Identify what's happening in the interface (check where the mouse cursor is)
2. Note any clicks, inputs, or interactions
3. Include specific values, text entries, or selections made
4. Avoid doing general descriptions of the interface, only describe actions and specific parts of the interface that are relevant to the action

Your response MUST follow this exact JSON structure:
{
  "metadata": {
    "title": "Brief descriptive title of workflow",
    "url": "Starting URL of the workflow",
    "totalSteps": number
  },
  "steps": [
    {
      "stepNumber": 1,
      "action": "Detailed description of action (click, type, select)",
      "target": "Precise description of what element is being targeted",
      "value": "Any entered value or selection made (if applicable)",
      "url": "Current page URL for this step",
      "expectedResult": "What should happen after this action"
    },
    ...additional steps...
  ],
  "summary": "Brief overview of what this automation accomplishes"
}

Here are examples of well-structured outputs:

EXAMPLE 1:
{
  "metadata": {
    "title": "Login to Gmail and Send Email",
    "url": "https://gmail.com",
    "totalSteps": 5
  },
  "steps": [
    {
      "stepNumber": 1,
      "action": "Navigate",
      "target": "Browser address bar",
      "value": "https://gmail.com",
      "url": "https://gmail.com",
      "expectedResult": "Gmail login page loads"
    },
    {
      "stepNumber": 2,
      "action": "Type",
      "target": "Email input field",
      "value": "example@gmail.com",
      "url": "https://gmail.com",
      "expectedResult": "Email is entered in field"
    },
    {
      "stepNumber": 3,
      "action": "Click",
      "target": "Next button",
      "value": null,
      "url": "https://gmail.com",
      "expectedResult": "Password field appears"
    },
    {
      "stepNumber": 4,
      "action": "Type",
      "target": "Password input field",
      "value": "password123",
      "url": "https://gmail.com",
      "expectedResult": "Password is entered securely"
    },
    {
      "stepNumber": 5,
      "action": "Click",
      "target": "Sign in button",
      "value": null,
      "url": "https://gmail.com",
      "expectedResult": "Successfully logged into Gmail inbox"
    }
  ],
  "summary": "This automation logs into a Gmail account with credentials and navigates to the inbox."
}

EXAMPLE 2:
{
  "metadata": {
    "title": "Add Product to E-commerce Cart",
    "url": "https://example-shop.com",
    "totalSteps": 4
  },
  "steps": [
    {
      "stepNumber": 1,
      "action": "Navigate",
      "target": "Browser address bar",
      "value": "https://example-shop.com/products",
      "url": "https://example-shop.com/products",
      "expectedResult": "Product listing page loads"
    },
    {
      "stepNumber": 2,
      "action": "Click",
      "target": "Product card for 'Wireless Headphones'",
      "value": null,
      "url": "https://example-shop.com/products",
      "expectedResult": "Product detail page opens"
    },
    {
      "stepNumber": 3,
      "action": "Click",
      "target": "Color selector dropdown",
      "value": "Black",
      "url": "https://example-shop.com/products/wireless-headphones",
      "expectedResult": "Black color option is selected"
    },
    {
      "stepNumber": 4, 
      "action": "Click",
      "target": "Add to Cart button",
      "value": null,
      "url": "https://example-shop.com/products/wireless-headphones",
      "expectedResult": "Product added to cart, cart counter increases"
    }
  ],
  "summary": "This automation browses to an e-commerce site, selects a specific product, chooses options, and adds it to the shopping cart."
}

Do not include any explanations or notes outside of the JSON structure. Ensure your response is valid JSON that can be parsed programmatically.
`;

// POST /api/vlm/analyze - Analyze images with VLM and create script
router.post("/analyze", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();

        // Required request parameters
        const { recording_id, session_id, custom_prompt, use_default_prompt = true } = body;

        if (!recording_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id is required" };
            return;
        }

        if (!session_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "session_id is required" };
            return;
        }

        // Get the API key from environment variable
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Anthropic API key not configured" };
            return;
        }

        // Determine which prompt to use
        const prompt = use_default_prompt
            ? (custom_prompt ? `${DEFAULT_AUTOMATION_PROMPT}\n\n${custom_prompt}` : DEFAULT_AUTOMATION_PROMPT)
            : custom_prompt;

        if (!use_default_prompt && !custom_prompt) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Either use_default_prompt must be true or custom_prompt must be provided" };
            return;
        }

        // Fetch all images for the recording
        const { data: imagesData, error: imagesError } = await supabase
            .from('images')
            .select('id, file_path, sequence, captured_at')
            .eq('recording_id', recording_id)
            .order('sequence', { ascending: true, nullsFirst: false })
            .order('captured_at', { ascending: true });

        if (imagesError || !imagesData || imagesData.length === 0) {
            ctx.response.status = imagesError ? 500 : 404;
            ctx.response.body = {
                error: imagesError ? "Failed to fetch images" : "No images found for the recording",
                message: imagesError?.message
            };
            return;
        }

        // Get session context if available
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('context')
            .eq('id', session_id)
            .single();

        if (sessionError && sessionError.code !== 'PGRST116') {
            console.error("Error fetching session data:", sessionError);
            // Continue even if this fails
        }

        // Prepare the content array for the Anthropic API
        const contentArray = [];

        // Add a text introduction including session context if available
        contentArray.push({
            type: "text",
            text: `Analyzing a sequence of ${imagesData.length} images showing a workflow. ` +
                (sessionData?.context ? `Session context: ${sessionData.context}` : '')
        });

        // Add each image to the content array
        for (const image of imagesData) {
            // Get direct public URL
            const imageUrl = `${supabaseUrl}/storage/v1/object/public/session-images/${image.file_path}`;

            contentArray.push({
                type: "image",
                source: {
                    type: "url",
                    url: imageUrl
                }
            });
        }

        // Add the prompt as the final text element
        contentArray.push({
            type: "text",
            text: prompt
        });
        console.log("contentArray ", contentArray);

        // Use our utility function to generate the script
        try {
            const scriptResult = await generateOrUpdateScript(apiKey, contentArray);

            // Extract the results
            const { scriptContent, isValidJson, structuredContent } = scriptResult;

            // Log the validation result
            if (isValidJson) {
                console.log("Successfully validated JSON structure");
            } else {
                console.warn("Failed to get valid JSON structure after retries");
            }

            // Create a new script record in the database
            const { data: scriptData, error: scriptError } = await supabase
                .from('scripts')
                .insert([{
                    session_id,
                    content: scriptContent,
                    status: 'completed',
                    is_structured: isValidJson,
                    structured_data: isValidJson ? structuredContent : null
                }])
                .select()
                .single();

            if (scriptError) {
                console.error("Failed to save script:", scriptError);
                ctx.response.status = 500;
                ctx.response.body = {
                    error: "Failed to save generated script",
                    message: scriptError.message
                };
                return;
            }
            console.log("scriptData ", scriptData);
            // Return the script data and analysis to the client
            ctx.response.body = {
                recording_id,
                session_id,
                model: MODEL,
                script: scriptData,
                is_structured: isValidJson,
                analysis: structuredContent
            };

        } catch (err) {
            console.error("Error in VLM analysis:", err);
            ctx.response.status = 500;
            ctx.response.body = { error: "Internal server error during image analysis" };
        }

    } catch (err) {
        console.error("Error in VLM analysis:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during image analysis" };
    }
});

export default router;

// POST /api/vlm/structured-analyze - Analyze images with guaranteed structured output
router.post("/structured-analyze", async (ctx: Context) => {
    try {
        if (!ctx.request.hasBody) {
            ctx.response.status = 400;
            ctx.response.body = { error: "Request body is required" };
            return;
        }

        const body = await ctx.request.body.json();

        // Required request parameters
        const { recording_id, session_id, custom_prompt } = body;

        if (!recording_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "recording_id is required" };
            return;
        }

        if (!session_id) {
            ctx.response.status = 400;
            ctx.response.body = { error: "session_id is required" };
            return;
        }

        // Get the API key from environment variable
        const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
        if (!apiKey) {
            ctx.response.status = 500;
            ctx.response.body = { error: "Anthropic API key not configured" };
            return;
        }

        // Always use structured prompt
        const structuredPrompt = `
Analyze these screenshots of a workflow or task and create a detailed automation script in JSON format.
For each step shown in the images (ordered chronologically):
1. Identify what's happening in the interface (check where the mouse cursor is)
2. Note any clicks, inputs, or interactions
3. Include specific values, text entries, or selections made
4. Avoid doing general descriptions of the interface, only describe actions and specific parts of the interface that are relevant to the action

Your response MUST follow this exact JSON structure:
{
  "metadata": {
    "title": "Brief descriptive title of workflow",
    "url": "Starting URL of the workflow",
    "totalSteps": number
  },
  "steps": [
    {
      "stepNumber": 1,
      "action": "Detailed description of action (click, type, select)",
      "target": "Precise description of what element is being targeted",
      "value": "Any entered value or selection made (if applicable)",
      "url": "Current page URL for this step",
      "expectedResult": "What should happen after this action"
    },
    ...additional steps...
  ],
  "summary": "Brief overview of what this automation accomplishes"
}

${custom_prompt ? `\n\nAdditional context for analysis: ${custom_prompt}` : ''}

Do not include any explanations or notes outside of the JSON structure. Ensure your response is valid JSON that can be parsed programmatically.`;

        // Fetch all images for the recording
        const { data: imagesData, error: imagesError } = await supabase
            .from('images')
            .select('id, file_path, sequence, captured_at')
            .eq('recording_id', recording_id)
            .order('sequence', { ascending: true, nullsFirst: false })
            .order('captured_at', { ascending: true });

        if (imagesError || !imagesData || imagesData.length === 0) {
            ctx.response.status = imagesError ? 500 : 404;
            ctx.response.body = {
                error: imagesError ? "Failed to fetch images" : "No images found for the recording",
                message: imagesError?.message
            };
            return;
        }

        // Get session context if available
        const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .select('context')
            .eq('id', session_id)
            .single();

        if (sessionError && sessionError.code !== 'PGRST116') {
            console.error("Error fetching session data:", sessionError);
            // Continue even if this fails
        }

        // Prepare the content array for the Anthropic API
        const contentArray = [];

        // Add a text introduction including session context if available
        contentArray.push({
            type: "text",
            text: `Analyzing a sequence of ${imagesData.length} images showing a workflow. ` +
                (sessionData?.context ? `Session context: ${sessionData.context}` : '')
        });

        // Add each image to the content array
        for (const image of imagesData) {
            // Get direct public URL
            const imageUrl = `${supabaseUrl}/storage/v1/object/public/session-images/${image.file_path}`;

            contentArray.push({
                type: "image",
                source: {
                    type: "url",
                    url: imageUrl
                }
            });
        }

        // Add the prompt as the final text element
        contentArray.push({
            type: "text",
            text: structuredPrompt
        });

        // Format the request for Anthropic API
        const anthropicRequest = {
            max_tokens: 64000,
            model: MODEL,
            system: "You are an expert in analyzing workflows from screenshots and converting them into structured automation scripts. You MUST always output valid JSON that follows the exact structure provided in the prompt. Never include markdown formatting, explanations, or text outside of the JSON structure.",
            messages: [
                {
                    role: "user",
                    content: contentArray
                }
            ]
        };

        // Call the Anthropic API
        let response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify(anthropicRequest)
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Anthropic API error:", errorData);
            ctx.response.status = response.status;
            ctx.response.body = {
                error: "Failed to analyze images with Anthropic API",
                details: errorData
            };
            return;
        }

        let result = await response.json();

        // Extract the script content from the result
        let scriptContent = result.content[0].text;

        // Validate JSON structure of the response
        let structuredContent;
        let isValidJson = true;
        let retryCount = 0;
        const MAX_RETRIES = 2; // More retries for the structured endpoint

        // Function to validate JSON structure
        const validateJsonStructure = (content: string) => {
            try {
                // Try direct parsing
                let parsedJson = JSON.parse(content);

                // Validate required structure
                if (!parsedJson.metadata || !parsedJson.steps || !Array.isArray(parsedJson.steps)) {
                    return null;
                }
                return parsedJson;
            } catch (directError) {
                // Try extracting JSON with regex
                try {
                    const jsonMatch = content.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        let extractedJson = JSON.parse(jsonMatch[0]);

                        // Validate required structure
                        if (!extractedJson.metadata || !extractedJson.steps || !Array.isArray(extractedJson.steps)) {
                            return null;
                        }
                        return extractedJson;
                    }
                } catch (extractError) {
                    return null;
                }
            }
            return null;
        };

        // Initially try to validate
        structuredContent = validateJsonStructure(scriptContent);
        isValidJson = structuredContent !== null;

        // If validation fails, retry with a more explicit prompt
        while (!isValidJson && retryCount < MAX_RETRIES) {
            console.log(`Retry attempt ${retryCount + 1}: Invalid JSON structure detected, retrying with more explicit instructions`);

            // Create a retry prompt with the original response
            const retryContentArray = [
                {
                    type: "text",
                    text: `Your previous response was not in the required JSON format. Here is what you provided:\n\n${scriptContent}\n\nPlease reformat this into a valid JSON object following EXACTLY this structure:\n\n{
  "metadata": {
    "title": "Brief descriptive title of workflow",
    "url": "Starting URL of the workflow",
    "totalSteps": number
  },
  "steps": [
    {
      "stepNumber": 1,
      "action": "Detailed description of action (click, type, select)",
      "target": "Precise description of what element is being targeted",
      "value": "Any entered value or selection made (if applicable)",
      "url": "Current page URL for this step",
      "expectedResult": "What should happen after this action"
    },
    ...
  ],
  "summary": "Brief overview of what this automation accomplishes"
}\n\nYour entire response must be valid JSON with no text outside the JSON structure. Ensure it can be parsed with JSON.parse().`
                }
            ];

            // Create a retry request
            const retryRequest = {
                max_tokens: 64000,
                model: MODEL,
                system: "You are an expert in converting information into properly structured JSON. Given the previous attempt that failed validation, reformat it into valid JSON following exactly the structure specified. Output ONLY the JSON object with no other text.",
                messages: [
                    {
                        role: "user",
                        content: retryContentArray
                    }
                ]
            };

            // Call API again
            response = await fetch(ANTHROPIC_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": apiKey,
                    "anthropic-version": "2023-06-01"
                },
                body: JSON.stringify(retryRequest)
            });

            if (!response.ok) {
                break; // If retry fails, use the original response
            }

            result = await response.json();
            scriptContent = result.content[0].text;

            // Validate the retry response
            structuredContent = validateJsonStructure(scriptContent);
            isValidJson = structuredContent !== null;

            retryCount++;
        }

        // If validation still fails after retries, make a final attempt to create a valid JSON structure
        if (!isValidJson) {
            console.log("All retries failed. Making final attempt to create a structured output from the raw text.");

            // Extract any meaningful content sections from the text
            const lines: string[] = scriptContent.split('\n').filter(line => line.trim() !== '');
            const steps = [];

            // Try to extract steps from numbered items
            let currentStep = null;
            let stepNumber = 1;
            let title = "Unknown Workflow";
            let summary = "";

            // Look for title-like text in the first few lines
            for (let i = 0; i < Math.min(5, lines.length); i++) {
                if (lines[i].includes("Title:") || lines[i].includes("Workflow:")) {
                    title = lines[i].split(":")[1]?.trim() || title;
                    break;
                }
            }

            // Look for step-like patterns
            for (const line: string of lines) {
                const stepMatch = line.match(/^(\d+)[.):]\s+(.*)/);
                if (stepMatch) {
                    const num = parseInt(stepMatch[1]);
                    const description = stepMatch[2];

                    steps.push({
                        stepNumber: num,
                        action: description,
                        target: "Unknown",
                        value: null,
                        url: "Unknown",
                        expectedResult: "Complete step successfully"
                    });

                    stepNumber = num + 1;
                }
            }

            // Look for summary-like text in the last few lines
            for (let i = Math.max(0, lines.length - 5); i < lines.length; i++) {
                if (lines[i].includes("Summary:") || lines[i].toLowerCase().includes("summary")) {
                    summary = lines[i].split(":", 2)[1]?.trim() || "Workflow automation";
                    break;
                }
            }

            // Create a basic structured content
            structuredContent = {
                metadata: {
                    title: title,
                    url: "Unknown starting URL",
                    totalSteps: steps.length
                },
                steps: steps.length > 0 ? steps : [
                    {
                        stepNumber: 1,
                        action: "Follow the workflow as described in the text",
                        target: "Unknown",
                        value: null,
                        url: "Unknown",
                        expectedResult: "Complete the workflow successfully"
                    }
                ],
                summary: summary || "This automation script was automatically generated from unstructured content."
            };

            // Set flag to indicate the structure was auto-generated
            isValidJson = true;
            scriptContent = JSON.stringify(structuredContent, null, 2);
        }

        // Create a new script record in the database
        const { data: scriptData, error: scriptError } = await supabase
            .from('scripts')
            .insert([{
                session_id,
                content: scriptContent,
                status: 'completed',
                is_structured: isValidJson,
                structured_data: isValidJson ? structuredContent : null
            }])
            .select()
            .single();

        if (scriptError) {
            console.error("Failed to save script:", scriptError);
            ctx.response.status = 500;
            ctx.response.body = {
                error: "Failed to save generated script",
                message: scriptError.message
            };
            return;
        }

        // Return the script data and analysis to the client
        ctx.response.body = {
            recording_id,
            session_id,
            model: MODEL,
            script: scriptData,
            is_structured: isValidJson,
            analysis: structuredContent,
            retry_count: retryCount
        };

    } catch (err) {
        console.error("Error in structured VLM analysis:", err);
        ctx.response.status = 500;
        ctx.response.body = { error: "Internal server error during structured image analysis" };
    }
}); 