export function normalizeUrl(url: string): string {
  let normalized = url.trim()
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = `http://${normalized}`
  }
  normalized = normalized.replace(/\/+$/, '')
  return normalized
}

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateUrl(url: string): ValidationResult {
  if (!url || !url.trim()) {
    return { valid: false, error: 'URL is required' }
  }

  const trimmed = url.trim()

  if (!/^https?:\/\//i.test(trimmed)) {
    return { valid: false, error: 'URL must start with http:// or https://' }
  }

  try {
    const parsed = new URL(trimmed)

    if (!parsed.hostname) {
      return { valid: false, error: 'URL must include a hostname' }
    }

    if (/xxx/i.test(parsed.hostname)) {
      return { valid: false, error: 'Replace the placeholder URL with your server\'s actual address' }
    }

    if (parsed.username || parsed.password) {
      return { valid: false, error: 'Embedded credentials in URL are not allowed. Use the pairing token field instead.' }
    }

    if (parsed.protocol === 'http:' && !isLocalOrPrivateHost(parsed.hostname)) {
      return { valid: true, error: 'Using HTTP over the internet is not secure. Use HTTPS or a VPN for remote connections.' }
    }

    return { valid: true }
  } catch {
    return { valid: false, error: 'Invalid URL format' }
  }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'localhost' ||
    host.endsWith('.local') ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)
  )
}

export function sanitizeUrlForDisplay(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username) {
      parsed.username = ''
    }
    if (parsed.password) {
      parsed.password = ''
    }
    return parsed.toString().replace(/\/+$/, '')
  } catch {
    return url.replace(/\/\/.*@/, '//[credentials-hidden]@')
  }
}

/**
 * True when an HTTP (not HTTPS) server address is either on a private/local
 * network or an explicit, user-accepted exception. T3 Code servers commonly run
 * on LAN/VPN without TLS, so this gates a warning rather than blocking.
 */
export function isPrivateHostname(hostname: string): boolean {
  return isLocalOrPrivateHost(hostname)
}
