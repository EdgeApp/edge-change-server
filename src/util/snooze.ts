export async function snooze(ms: number): Promise<void> {
  return await new Promise(resolve => setTimeout(resolve, ms))
}
