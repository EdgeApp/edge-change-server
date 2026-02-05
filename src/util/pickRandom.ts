/**
 * Pick a random element from an array.
 *
 * @param arr - The array to pick from.
 * @returns A random element from the array.
 */
export function pickRandom<T>(arr: T[]): T | undefined {
  return arr[Math.floor(Math.random() * arr.length)]
}
