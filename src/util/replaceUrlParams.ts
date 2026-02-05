/**
 * Replaces {{paramName}} placeholders in a URL with supplied params.
 * Returns the URL unchanged if no placeholders are found or params are not
 * provided.
 */
export function replaceUrlParams(
  url: string,
  params: Record<string, string>
): string {
  let result = url
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{{${key}}}`, value)
  }
  return result
}
