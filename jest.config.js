module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  forceExit: true,
  setupFiles: ['./jest.setup.ts'],
  testTimeout: 10000
}
