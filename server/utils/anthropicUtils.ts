/**
 * Utility functions for working with the Anthropic API
 * Handles script generation, validation, and reformatting
 */

// Constants
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-3-7-sonnet-latest";

// Interface for script validation
export interface ScriptJSON {
    metadata: {
        title: string;
        url: string;
        totalSteps: number;
    };
    steps: Array<{
        stepNumber: number;
        action: string;
        target: string;
        value: string | null;
        url: string;
        expectedResult: string;
    }>;
    summary: string;
}

/**
 * Validates if a string is a properly structured script JSON
 * @param content - JSON string to validate
 * @returns Parsed JSON if valid, null otherwise
 */
export function validateScriptJSON(content: string): ScriptJSON | null {
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
}

/**
 * Attempts to reformat invalid JSON by making another API call
 * @param apiKey - Anthropic API key
 * @param originalContent - Original invalid JSON content
 * @returns Reformatted JSON object if successful, null otherwise
 */
export async function reformatInvalidJSON(apiKey: string, originalContent: string): Promise<string | null> {
    try {
        if (!originalContent || originalContent.trim() === "") {
            console.error("Cannot reformat empty content");
            return null;
        }

        // Create a retry prompt with the original response
        const retryContentArray = [
            {
                type: "text",
                text: `Your previous response was not in the required JSON format. Here is what you provided:\n\n${originalContent}\n\nPlease reformat this into a valid JSON object following EXACTLY this structure:\n\n{
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
}\n\nDo not include any text or explanations outside the JSON structure. Your entire response should be valid JSON that can be parsed with JSON.parse().`
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
        const response = await fetch(ANTHROPIC_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify(retryRequest)
        });

        if (!response.ok) {
            const errorStatus = `${response.status} ${response.statusText}`;
            const errorBody = await response.text();
            console.error(`Error reformatting JSON: API returned ${errorStatus}`, errorBody);
            return null;
        }

        const result = await response.json();
        if (!result.content || !result.content[0] || !result.content[0].text) {
            console.error("Invalid response format from API:", result);
            return null;
        }

        return result.content[0].text;
    } catch (error) {
        console.error("Error reformatting JSON:", error);
        return null;
    }
}

/**
 * Generates or updates a script using the Anthropic API
 * @param apiKey - Anthropic API key
 * @param contentArray - Array of content elements for the prompt (text, images)
 * @param systemPrompt - System prompt for the API call
 * @returns Generated script content and validation result
 */
export async function generateOrUpdateScript(
    apiKey: string,
    contentArray: Array<{ type: string, text?: string, source?: any }>,
    systemPrompt: string = "You are an expert in analyzing workflows from screenshots and converting them into structured automation scripts. You MUST always output valid JSON that follows the exact structure provided in the prompt. Never include markdown formatting, explanations, or text outside of the JSON structure."
): Promise<{
    scriptContent: string;
    isValidJson: boolean;
    structuredContent: ScriptJSON | null;
}> {
    try {
        // Validate content array to prevent empty text blocks
        console.log("Content array:", contentArray);
        const validContentArray = contentArray.filter(item => {
            // Keep non-text items or text items with non-empty content
            return item.type !== "text" || (item.text && item.text.trim() !== "");
        });

        if (validContentArray.length === 0) {
            throw new Error("Content array cannot be empty or contain only empty text blocks");
        }

        // Format the request for Anthropic API
        const anthropicRequest = {
            max_tokens: 64000,
            model: MODEL,
            system: systemPrompt,
            messages: [
                {
                    role: "user",
                    content: validContentArray
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
            console.log("Anthropic API error:", response.status, response.statusText);
            const errorBody = await response.text();
            console.log("Error response body:", errorBody);
            throw new Error(`API error: ${response.status}`);
        }

        let result = await response.json();
        let scriptContent = result.content[0].text;

        // Validate JSON structure of the response
        let structuredContent = validateScriptJSON(scriptContent);
        let isValidJson = structuredContent !== null;

        // If validation fails, retry with a more explicit prompt
        if (!isValidJson) {
            console.log("Invalid JSON structure detected, retrying with more explicit instructions");
            const reformattedContent = await reformatInvalidJSON(apiKey, scriptContent);

            if (reformattedContent) {
                scriptContent = reformattedContent;
                structuredContent = validateScriptJSON(scriptContent);
                isValidJson = structuredContent !== null;
            }
        }

        return {
            scriptContent,
            isValidJson,
            structuredContent
        };
    } catch (error) {
        console.error("Error generating script:", error);
        throw error;
    }
}

/**
 * Updates an existing script with new context
 * @param apiKey - Anthropic API key
 * @param existingScript - Existing script JSON or string representation
 * @param contextPrompt - New context to incorporate
 * @returns Updated script content and validation result
 */
export async function updateScriptWithContext(
    apiKey: string,
    existingScript: string | ScriptJSON,
    contextPrompt: string
): Promise<{
    scriptContent: string;
    isValidJson: boolean;
    structuredContent: ScriptJSON | null;
}> {
    // Convert script to string if it's an object
    const scriptString = typeof existingScript === 'string'
        ? existingScript
        : JSON.stringify(existingScript, null, 2);

    // Make sure both inputs are not empty
    if (!scriptString.trim() || !contextPrompt.trim()) {
        throw new Error("Script and context prompt cannot be empty");
    }

    // Create content array with context and existing script
    const contentArray = [
        {
            type: "text",
            text: `Update the following automation script with this additional context: "${contextPrompt}"\n\nKeep the same JSON structure but modify the steps, metadata, or summary as needed to incorporate this context. The existing script is:\n\n${scriptString}\n\nReturn the updated script as properly formatted JSON with the same structure.`
        }
    ];

    // Use the generic function to handle the API call and validation
    return generateOrUpdateScript(
        apiKey,
        contentArray,
        "You are an expert in updating automation scripts. Modify the provided script based on the new context while maintaining its JSON structure. Only output the updated JSON with no additional text."
    );
}

export default {
    validateScriptJSON,
    reformatInvalidJSON,
    generateOrUpdateScript,
    updateScriptWithContext
}; 