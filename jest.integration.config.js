module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  forceExit: true,
  // No setupFiles - we don't want the mocks for integration tests
  testTimeout: 60000,
  testMatch: ['**/test/v2/**/*.test.ts']
}
