import { normalizeUrl } from './url'

/**
 * T3 Code authorizes a new device with a one-time pairing token that the server
 * mints (`t3 pair`) and prints as a URL such as:
 *
 *   http://192.168.1.100:3773/pair#token=U4SZWDHQSG7L
 *
 * The receiving app opens that URL and the grant is remembered for later
 * connections. This module turns whatever a user pastes — a bare token, or a
 * full pairing URL (or QR payload) — into the pieces the app needs.
 */

const PAIRING_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{4,512}$/

function tokenFromUrl(url: URL): string | null {
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
  const fromFragment = new URLSearchParams(hash).get('token')
  if (fromFragment) return fromFragment.trim()
  const fromQuery = url.searchParams.get('token')
  if (fromQuery) return fromQuery.trim()
  return null
}

export interface ParsedPairing {
  /** Present only when the input was a full pairing URL. */
  baseUrl?: string
  token: string
}

/**
 * Reads a pairing token from user input.
 *
 * Accepts a bare token or a full `http(s)://host[:port]/pair#token=...` URL.
 * Returns `null` when no plausible token can be found.
 */
export function parsePairingInput(input: string): ParsedPairing | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      const token = tokenFromUrl(url)
      if (!token) return null
      return {
        baseUrl: `${url.protocol}//${url.host}`,
        token,
      }
    } catch {
      return null
    }
  }

  if (!PAIRING_TOKEN_PATTERN.test(trimmed)) return null
  return { token: trimmed }
}

/** Extracts just the token, ignoring any URL that carried it. */
export function extractPairingToken(input: string): string | null {
  return parsePairingInput(input)?.token ?? null
}

/**
 * Builds the URL the WebView should open to authorize a new device. T3 Code
 * reads the token from the fragment, so it never reaches a server log.
 */
export function buildPairUrl(baseUrl: string, token: string): string {
  return `${normalizeUrl(baseUrl)}/pair#token=${encodeURIComponent(token)}`
}

/** Builds the plain app URL, used once a device is already paired. */
export function buildAppUrl(baseUrl: string): string {
  return `${normalizeUrl(baseUrl)}/`
}
