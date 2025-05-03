/**
 * Types related to automation scripts
 */

/**
 * Structure of a script step
 */
export interface ScriptStep {
    stepNumber: number;
    action: string;
    target: string;
    value: string | null;
    url: string;
    expectedResult: string;
}

/**
 * Structure of a parsed script
 */
export interface ParsedScript {
    id?: string;
    metadata: {
        title: string;
        url: string;
        totalSteps: number;
    };
    steps: ScriptStep[];
    summary: string;
} 