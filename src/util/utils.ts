// Shuffles array and returns a new array.
export const shuffleArray = <T>(array: T[]): T[] => {
  return array.sort(() => Math.random() - 0.5)
}
