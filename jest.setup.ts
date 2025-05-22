import { jest } from '@jest/globals'

// Mock the serviceKeys object to be empty:
jest.mock('./src/serverConfig', () => ({
  serverConfig: {
    serviceKeys: {
      'eth.blockscout.com': []
    }
  }
}))
