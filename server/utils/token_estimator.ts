/**
 * Token estimation utilities for the Gemini API
 * 
 * These functions provide rough estimates of token usage for different content types
 * based on general LLM tokenization heuristics.
 */

/**
 * Estimates the number of tokens in a text string
 * @param text The text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
    // For English text: ~4 characters per token is a decent estimate
    // This will vary by language, but it's a reasonable approximation
    return Math.ceil(text.length / 4);
}

/**
 * Estimates the number of tokens for an image based on its base64 data
 * @param imageBase64 The base64-encoded image data (without data URL prefix)
 * @returns Estimated token count
 */
export function estimateImageTokens(imageBase64: string): number {
    // Gemini handles images differently than text
    // This is a rough approximation for a typical screenshot
    // Actual token count depends on image size and complexity
    const imageSizeBytes = (imageBase64.length * 3) / 4; // Base64 to bytes
    const imageSizeKB = imageSizeBytes / 1024;

    // Roughly estimate based on image size
    // Images are typically 300-500 tokens per 100KB
    return Math.ceil(imageSizeKB * 4);
}

/**
 * Comprehensive token estimation for Gemini API requests
 * @param params Object containing various content to estimate tokens for
 * @returns Detailed token estimation breakdown
 */
export function estimateGeminiTokens(params: {
    systemPrompt: string;
    screenshot: string;
    html: string;
    markdown?: string;
    instruction?: string;
    previousAction?: string;
    stepContext?: string;
}) {
    const {
        systemPrompt,
        screenshot,
        html,
        markdown = "",
        instruction = "",
        previousAction = "",
        stepContext = ""
    } = params;

    // Extract the image data without the data URL prefix
    const imageBase64 = screenshot.replace(/^data:image\/png;base64,/, "");

    // Estimate tokens for different parts of the request
    const systemTokens = estimateTokens(systemPrompt);
    const imageTokens = estimateImageTokens(imageBase64);
    const htmlTokens = estimateTokens(html);
    const miscTokens = estimateTokens(JSON.stringify({
        markdown,
        instruction,
        previousAction,
        stepContext
    }));

    // Calculate total estimated tokens
    const totalEstimatedTokens = systemTokens + imageTokens + htmlTokens + miscTokens;

    // Size information in KB
    const htmlSizeKB = (html.length / 1024).toFixed(2);
    const imageSizeKB = (imageBase64.length / 1024).toFixed(2);

    return {
        systemTokens,
        imageTokens,
        htmlTokens,
        miscTokens,
        totalEstimatedTokens,
        htmlSizeKB,
        imageSizeKB,

        // Helper method to log the estimates to console
        logEstimates() {
            console.log(`=== TOKEN ESTIMATION FOR GEMINI API ===`);
            console.log(`System prompt tokens: ~${systemTokens}`);
            console.log(`Image tokens: ~${imageTokens}`);
            console.log(`HTML tokens: ~${htmlTokens}`);
            console.log(`Misc context tokens: ~${miscTokens}`);
            console.log(`TOTAL estimated tokens: ~${totalEstimatedTokens}`);
            console.log(`HTML size: ${htmlSizeKB} KB`);
            console.log(`Image size: ${imageSizeKB} KB`);
            console.log(`======================================`);
        }
    };
} 