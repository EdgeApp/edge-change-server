import { jest } from '@jest/globals'

// Mock the serviceKeys object to be empty:
jest.mock('./src/serverConfig', () => ({
  serverConfig: {
    serviceKeys: {
      'api.etherscan.io': ['JYMB141VYKJ2KPVMYJUZC8PXGWKUFVFX8N'],
      'eth.blockscout.com': []
    }
  }
}))
