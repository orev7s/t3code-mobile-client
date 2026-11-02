import { describe, it, expect } from 'vitest'
import { buildAppUrl, buildPairUrl, extractPairingToken, parsePairingInput } from '@/services/t3code/pairing'

describe('parsePairingInput', () => {
  it('accepts a bare token', () => {
    expect(parsePairingInput('U4SZWDHQSG7L')).toEqual({ token: 'U4SZWDHQSG7L' })
  })

  it('pulls the base URL and token out of a pairing URL', () => {
    expect(parsePairingInput('http://192.168.1.100:3773/pair#token=U4SZWDHQSG7L')).toEqual({
      baseUrl: 'http://192.168.1.100:3773',
      token: 'U4SZWDHQSG7L',
    })
  })

  it('reads a token from the query string too', () => {
    expect(parsePairingInput('https://box.example.com/pair?token=abc123')).toEqual({
      baseUrl: 'https://box.example.com',
      token: 'abc123',
    })
  })

  it('uses the host without credentials or trailing path', () => {
    expect(parsePairingInput('https://host:8443/pair#token=xyz')?.baseUrl).toBe('https://host:8443')
  })

  it('rejects a pairing URL with no token', () => {
    expect(parsePairingInput('http://host:3773/pair')).toBeNull()
  })

  it('rejects empty input and obvious non-tokens', () => {
    expect(parsePairingInput('')).toBeNull()
    expect(parsePairingInput('   ')).toBeNull()
    expect(parsePairingInput('has spaces in it')).toBeNull()
  })

  it('extracts just the token', () => {
    expect(extractPairingToken('http://host:3773/pair#token=abc')).toBe('abc')
    expect(extractPairingToken('bare-token')).toBe('bare-token')
  })
})

describe('buildPairUrl', () => {
  it('normalizes the base URL and puts the token in the fragment', () => {
    expect(buildPairUrl('192.168.1.100:3773', 'U4SZWDHQSG7L'))
      .toBe('http://192.168.1.100:3773/pair#token=U4SZWDHQSG7L')
  })

  it('encodes the token', () => {
    expect(buildPairUrl('http://host:3773', 'a b/c')).toBe('http://host:3773/pair#token=a%20b%2Fc')
  })

  it('drops trailing slashes from the base URL', () => {
    expect(buildPairUrl('http://host:3773//', 'tok')).toBe('http://host:3773/pair#token=tok')
  })
})

describe('buildAppUrl', () => {
  it('builds the plain app URL', () => {
    expect(buildAppUrl('192.168.1.100:3773')).toBe('http://192.168.1.100:3773/')
  })
})
