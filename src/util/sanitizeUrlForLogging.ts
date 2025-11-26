/**
 * Sanitizes a URL for safe logging by removing sensitive information like API keys.
 *
 * @param url - The URL to sanitize
 * @returns A sanitized URL safe for logging
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const urlObj = new URL(url)

    // Remove API keys from path segments (e.g., /wss/api-key -> /wss)
    // This handles cases where API keys are appended as path segments
    const pathParts = urlObj.pathname.split('/').filter(Boolean)
    // If the last path segment looks like an API key (long alphanumeric string),
    // remove it. API keys are typically 20+ characters.
    if (
      pathParts.length > 0 &&
      pathParts[pathParts.length - 1].length >= 20 &&
      /^[a-zA-Z0-9]+$/.test(pathParts[pathParts.length - 1])
    ) {
      pathParts.pop()
      urlObj.pathname = '/' + pathParts.join('/')
    }

    // Remove API keys from query parameters
    urlObj.searchParams.delete('apikey')
    urlObj.searchParams.delete('api_key')
    urlObj.searchParams.delete('apiKey')

    return urlObj.toString()
  } catch {
    // If URL parsing fails, return the original URL
    return url
  }
}
