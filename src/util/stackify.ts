export function stackify(error: unknown): string {
  if (error instanceof Error) return error.stack ?? String(error)
  return JSON.stringify(error)
}
