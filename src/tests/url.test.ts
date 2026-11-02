import { describe, it, expect } from 'vitest'
import {
  normalizeUrl,
  validateUrl,
  sanitizeUrlForDisplay,
  isPrivateHostname,
} from '@/services/t3code/url'

describe('normalizeUrl', () => {
  it('adds http:// if no protocol', () => {
    expect(normalizeUrl('192.168.1.100:3773')).toBe('http://192.168.1.100:3773')
  })

  it('keeps https:// if present', () => {
    expect(normalizeUrl('https://t3code.example.com')).toBe('https://t3code.example.com')
  })

  it('keeps http:// if present', () => {
    expect(normalizeUrl('http://localhost:3773')).toBe('http://localhost:3773')
  })

  it('removes trailing slashes', () => {
    expect(normalizeUrl('http://192.168.1.100:3773///')).toBe('http://192.168.1.100:3773')
  })

  it('trims whitespace', () => {
    expect(normalizeUrl('  http://localhost:3773  ')).toBe('http://localhost:3773')
  })
})

describe('validateUrl', () => {
  it('accepts valid http URL', () => {
    const result = validateUrl('http://192.168.1.100:3773')
    expect(result.valid).toBe(true)
  })

  it('accepts valid https URL', () => {
    const result = validateUrl('https://t3code.example.com')
    expect(result.valid).toBe(true)
  })

  it('rejects empty URL', () => {
    const result = validateUrl('')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('required')
  })

  it('rejects missing protocol', () => {
    const result = validateUrl('192.168.1.100')
    expect(result.valid).toBe(false)
  })

  it('rejects embedded username in URL', () => {
    const result = validateUrl('http://user@host:3773')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('credentials')
  })

  it('rejects embedded username:password in URL', () => {
    const result = validateUrl('http://user:pass@host:3773')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('credentials')
  })

  it('rejects invalid format', () => {
    const result = validateUrl('not a url')
    expect(result.valid).toBe(false)
  })

  it('warns about non-LAN HTTP', () => {
    const result = validateUrl('http://example.com:3773')
    expect(result.valid).toBe(true)
    expect(result.error).toContain('not secure')
  })

  it('accepts LAN HTTP without warning', () => {
    const result = validateUrl('http://192.168.1.100:3773')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts localhost HTTP', () => {
    const result = validateUrl('http://localhost:3773')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts Tailscale CGNAT HTTP without warning', () => {
    const result = validateUrl('http://100.64.12.34:3773')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  it('accepts local mDNS HTTP without warning', () => {
    const result = validateUrl('http://t3code.local:3773')
    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })
})

describe('sanitizeUrlForDisplay', () => {
  it('strips username from URL', () => {
    const result = sanitizeUrlForDisplay('http://user@host:3773/path')
    expect(result).not.toContain('user@')
    expect(result).toContain('host')
  })

  it('strips username:password from URL', () => {
    const result = sanitizeUrlForDisplay('http://user:secret@host:3773/path')
    expect(result).not.toContain('user')
    expect(result).not.toContain('secret')
    expect(result).toContain('host')
  })

  it('keeps URL without credentials unchanged', () => {
    const result = sanitizeUrlForDisplay('http://192.168.1.100:3773')
    expect(result).toBe('http://192.168.1.100:3773')
  })

  it('handles invalid URLs gracefully', () => {
    const result = sanitizeUrlForDisplay('not-a-url')
    expect(result).toBeTruthy()
  })

  it('trailing slash removed', () => {
    const result = sanitizeUrlForDisplay('http://192.168.1.100:3773/')
    expect(result).toBe('http://192.168.1.100:3773')
  })
})

describe('isPrivateHostname', () => {
  it('treats LAN, loopback, CGNAT and mDNS hosts as private', () => {
    for (const host of ['localhost', '192.168.1.10', '10.0.0.5', '172.16.4.4', '100.64.0.9', 'box.local']) {
      expect(isPrivateHostname(host)).toBe(true)
    }
  })

  it('treats public hostnames as public', () => {
    expect(isPrivateHostname('example.com')).toBe(false)
    expect(isPrivateHostname('203.0.113.10')).toBe(false)
  })
})
