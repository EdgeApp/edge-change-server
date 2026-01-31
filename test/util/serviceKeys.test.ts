import { describe, expect, test } from '@jest/globals'

import {
  asServiceKeys,
  ServiceKeys,
  serviceKeysFromUrl
} from '../../src/util/serviceKeys'

describe('asServiceKeys', function () {
  test('valid service keys object', function () {
    const input = {
      'api.example.com': ['key1', 'key2'],
      'example.com': ['key3']
    }
    const result = asServiceKeys(input)
    expect(result).toEqual(input)
  })

  test('empty object is valid', function () {
    const input = {}
    const result = asServiceKeys(input)
    expect(result).toEqual({})
  })

  test('rejects non-string keys in array', function () {
    const input = {
      'api.example.com': ['key1', 123]
    }
    expect(() => asServiceKeys(input)).toThrow()
  })

  test('rejects non-array values', function () {
    const input = {
      'api.example.com': 'key1'
    }
    expect(() => asServiceKeys(input)).toThrow()
  })
})

describe('serviceKeysFromUrl', function () {
  describe('exact hostname matching', function () {
    test('matches exact hostname', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['key1', 'key2']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path'
      )
      expect(result).toEqual(['key1', 'key2'])
    })

    test('matches hostname with explicit port', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com:8080': ['portKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:8080/path'
      )
      expect(result).toEqual(['portKey'])
    })

    test('prefers hostname with port over hostname without port', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com:8080': ['portKey'],
        'api.example.com': ['noPortKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:8080/path'
      )
      expect(result).toEqual(['portKey'])
    })

    test('falls back to hostname without port when port key not found', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['noPortKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:8080/path'
      )
      expect(result).toEqual(['noPortKey'])
    })
  })

  describe('subdomain matching', function () {
    test('matches parent domain when subdomain not found', function () {
      const serviceKeys: ServiceKeys = {
        'example.com': ['parentKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path'
      )
      expect(result).toEqual(['parentKey'])
    })

    test('prefers more specific subdomain over parent domain', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['subdomainKey'],
        'example.com': ['parentKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path'
      )
      expect(result).toEqual(['subdomainKey'])
    })

    test('matches deeply nested subdomains', function () {
      const serviceKeys: ServiceKeys = {
        'example.com': ['rootKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://deep.nested.api.example.com/path'
      )
      expect(result).toEqual(['rootKey'])
    })

    test('matches at correct subdomain level', function () {
      const serviceKeys: ServiceKeys = {
        'nested.api.example.com': ['nestedKey'],
        'api.example.com': ['apiKey'],
        'example.com': ['rootKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://deep.nested.api.example.com/path'
      )
      expect(result).toEqual(['nestedKey'])
    })
  })

  describe('subdomain with port matching', function () {
    test('matches parent domain with port', function () {
      const serviceKeys: ServiceKeys = {
        'example.com:8080': ['portKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:8080/path'
      )
      expect(result).toEqual(['portKey'])
    })

    test('prefers subdomain with port over parent domain with port', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com:8080': ['subPortKey'],
        'example.com:8080': ['parentPortKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:8080/path'
      )
      expect(result).toEqual(['subPortKey'])
    })

    test('prefers subdomain with port over subdomain without port', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com:8080': ['subPortKey'],
        'api.example.com': ['subKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:8080/path'
      )
      expect(result).toEqual(['subPortKey'])
    })
  })

  describe('no match scenarios', function () {
    test('returns empty array when no keys match', function () {
      const serviceKeys: ServiceKeys = {
        'other.com': ['otherKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path'
      )
      expect(result).toEqual([])
    })

    test('returns empty array for empty service keys', function () {
      const serviceKeys: ServiceKeys = {}
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path'
      )
      expect(result).toEqual([])
    })

    test('does not match TLD only', function () {
      const serviceKeys: ServiceKeys = {
        com: ['tldKey']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path'
      )
      expect(result).toEqual([])
    })
  })

  describe('URL variations', function () {
    test('works with http protocol', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['key1']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'http://api.example.com/path'
      )
      expect(result).toEqual(['key1'])
    })

    test('works with query parameters', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['key1']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path?foo=bar'
      )
      expect(result).toEqual(['key1'])
    })

    test('works with fragment', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['key1']
      }
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com/path#section'
      )
      expect(result).toEqual(['key1'])
    })

    test('ignores default HTTPS port 443 (not included in URL.port)', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['key1']
      }
      // Standard port 443 is not included in URL.port property
      const result = serviceKeysFromUrl(
        serviceKeys,
        'https://api.example.com:443/path'
      )
      expect(result).toEqual(['key1'])
    })

    test('ignores default HTTP port 80 (not included in URL.port)', function () {
      const serviceKeys: ServiceKeys = {
        'api.example.com': ['key1']
      }
      // Standard port 80 is not included in URL.port property
      const result = serviceKeysFromUrl(
        serviceKeys,
        'http://api.example.com:80/path'
      )
      expect(result).toEqual(['key1'])
    })
  })
})
