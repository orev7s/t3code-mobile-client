import type { SecretStorageAdapter } from './secureSecretStorage'

const PREFIX = 't3code_dev_pair_'

function warnDev(): void {
  console.warn(
    '[T3 Code Mobile Client] Using WEB DEV fallback storage for secrets. ' +
    'Pairing tokens are stored in localStorage (insecure). ' +
    'This is only suitable for development. ' +
    'On native builds, @aparajita/capacitor-secure-storage is used.'
  )
}

function isDevelopment(): boolean {
  return typeof window !== 'undefined' &&
    window.location &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
}

export const webDevSecretStorage: SecretStorageAdapter = {
  async getSecret(profileId: string): Promise<string | null> {
    if (isDevelopment()) {
      warnDev()
    }
    try {
      return localStorage.getItem(`${PREFIX}${profileId}`)
    } catch {
      return null
    }
  },

  async setSecret(profileId: string, secret: string): Promise<void> {
    if (isDevelopment()) {
      warnDev()
    }
    try {
      localStorage.setItem(`${PREFIX}${profileId}`, secret)
    } catch {
      // storage full or unavailable
    }
  },

  async deleteSecret(profileId: string): Promise<void> {
    if (isDevelopment()) {
      warnDev()
    }
    try {
      localStorage.removeItem(`${PREFIX}${profileId}`)
    } catch {
      // ignore
    }
  },
}
