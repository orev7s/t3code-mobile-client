import { SecureStorage } from '@aparajita/capacitor-secure-storage'

/**
 * Stores per-server secrets (currently the T3 Code pairing token) in platform
 * secure storage: Android EncryptedSharedPreferences and iOS Keychain.
 */
export interface SecretStorageAdapter {
  getSecret(profileId: string): Promise<string | null>
  setSecret(profileId: string, secret: string): Promise<void>
  deleteSecret(profileId: string): Promise<void>
}

const SECRET_PREFIX = 't3code_pair_'

export const secureSecretStorage: SecretStorageAdapter = {
  async getSecret(profileId: string): Promise<string | null> {
    try {
      return await SecureStorage.getItem(`${SECRET_PREFIX}${profileId}`)
    } catch {
      return null
    }
  },

  async setSecret(profileId: string, secret: string): Promise<void> {
    await SecureStorage.setItem(`${SECRET_PREFIX}${profileId}`, secret)
  },

  async deleteSecret(profileId: string): Promise<void> {
    await SecureStorage.remove(`${SECRET_PREFIX}${profileId}`)
  },
}
