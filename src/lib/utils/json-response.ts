// ============================================
// JSON RESPONSE UTILITIES
// Clean and parse JSON responses from Claude API
// Handles markdown code blocks, control characters, and common JSON errors
// ============================================

/**
 * Clean raw Claude response text by removing markdown formatting
 * and other non-JSON artifacts
 */
export function cleanClaudeJsonResponse(responseText: string): string {
  let text = responseText;

  // Remove markdown code blocks (```json, ```JSON, ```)
  text = text.replace(/```json\s*/gi, '');
  text = text.replace(/```\s*/g, '');

  // Trim whitespace
  text = text.trim();

  // Remove BOM (Byte Order Mark) if present
  text = text.replace(/^\uFEFF/, '');

  // Remove zero-width characters
  text = text.replace(/[\u200B-\u200D\uFEFF]/g, '');

  return text;
}

/**
 * Extract a JSON object from response text
 * Finds the outermost { } boundaries
 */
export function extractJsonObject(responseText: string): string | null {
  const cleaned = cleanClaudeJsonResponse(responseText);

  // Find JSON object boundaries
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return cleaned.slice(start, end + 1);
}

/**
 * Extract a JSON array from response text
 * Finds the outermost [ ] boundaries
 */
export function extractJsonArray(responseText: string): string | null {
  const cleaned = cleanClaudeJsonResponse(responseText);

  // Find JSON array boundaries
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return cleaned.slice(start, end + 1);
}

/**
 * Fix common JSON syntax errors that Claude sometimes produces
 */
export function fixCommonJsonErrors(jsonString: string): string {
  return jsonString
    .replace(/,\s*}/g, '}')           // Remove trailing commas before }
    .replace(/,\s*]/g, ']')           // Remove trailing commas before ]
    .replace(/[\x00-\x1F\x7F]/g, ' ') // Remove control characters (except in strings)
    .replace(/\n\s*\n/g, '\n')        // Collapse multiple newlines
    .replace(/"\s*\n\s*"/g, '", "')   // Fix missing commas between string elements
    .replace(/}\s*\n\s*{/g, '}, {')   // Fix missing commas between objects
    .replace(/]\s*\n\s*\[/g, '], ['); // Fix missing commas between arrays
}

/**
 * Result type for JSON parsing operations
 */
export interface ParseJsonResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  fallbackUsed?: boolean;
}

/**
 * Parse a Claude JSON response with multiple fallback strategies
 *
 * @param responseText - The raw response text from Claude
 * @param isArray - Whether to expect a JSON array (true) or object (false)
 * @returns ParseJsonResult with success status and parsed data or error
 */
export function parseClaudeJson<T>(
  responseText: string,
  isArray: boolean = false
): ParseJsonResult<T> {
  // Step 1: Try clean extraction and direct parse
  const extracted = isArray
    ? extractJsonArray(responseText)
    : extractJsonObject(responseText);

  if (!extracted) {
    return {
      success: false,
      error: `No valid JSON ${isArray ? 'array' : 'object'} found in response`,
    };
  }

  try {
    const data = JSON.parse(extracted) as T;
    return { success: true, data };
  } catch (firstError) {
    // Step 2: Try with common error fixes
    try {
      const fixed = fixCommonJsonErrors(extracted);
      const data = JSON.parse(fixed) as T;
      console.warn('[json-response] Used fallback JSON parsing with error fixes');
      return { success: true, data, fallbackUsed: true };
    } catch (secondError) {
      const errorMessage = firstError instanceof Error ? firstError.message : 'Unknown error';
      console.error('[json-response] JSON parse failed after all attempts:', errorMessage);
      console.error('[json-response] Extracted content preview:', extracted.substring(0, 500));
      return {
        success: false,
        error: `JSON parse failed: ${errorMessage}`,
        fallbackUsed: true,
      };
    }
  }
}

/**
 * Parse JSON with a default fallback value
 * Returns the default if parsing fails instead of throwing
 */
export function parseClaudeJsonWithDefault<T>(
  responseText: string,
  defaultValue: T,
  isArray: boolean = false
): { data: T; parseIssue?: { fallbackUsed: boolean; error?: string } } {
  const result = parseClaudeJson<T>(responseText, isArray);

  if (result.success && result.data !== undefined) {
    return {
      data: result.data,
      parseIssue: result.fallbackUsed ? { fallbackUsed: true } : undefined,
    };
  }

  console.warn('[json-response] Using default value due to parse failure:', result.error);
  return {
    data: defaultValue,
    parseIssue: {
      fallbackUsed: true,
      error: result.error,
    },
  };
}
