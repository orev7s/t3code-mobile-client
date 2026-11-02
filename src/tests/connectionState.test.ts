import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useConnectionStore } from '@/stores/connectionStore'
import { useServerStore } from '@/stores/serverStore'
import * as healthModule from '@/services/t3code/health'

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn().mockResolvedValue({ value: '[]' }),
    set: vi.fn(),
  },
}))

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  SecureStorage: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn(),
    remove: vi.fn(),
  },
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false,
  },
}))

function newProfile(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test',
    baseUrl: 'http://192.168.1.100:3773',
    pairingEnabled: false,
    isDefault: false,
    allowInsecureHttp: true,
    lastStatus: 'unknown' as const,
    lastConnectedAt: null,
    ...overrides,
  }
}

describe('connectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('starts in idle state', () => {
    const store = useConnectionStore()
    expect(store.state).toBe('idle')
    expect(store.activeServerId).toBeNull()
    expect(store.isConnected).toBe(false)
    expect(store.isChecking).toBe(false)
  })

  it('transitions to checking and then to connected on success', async () => {
    vi.spyOn(healthModule, 'checkServerHealth').mockResolvedValue({
      reachable: true,
      status: 'connected',
      statusCode: 200,
    })

    const serverStore = useServerStore()
    const profile = await serverStore.add(newProfile())

    const store = useConnectionStore()
    const result = await store.connect(profile.id)

    expect(result).toBe(true)
    expect(store.state).toBe('connected')
    expect(store.activeServerId).toBe(profile.id)
  })

  it('transitions to unreachable on network error', async () => {
    vi.spyOn(healthModule, 'checkServerHealth').mockResolvedValue({
      reachable: false,
      status: 'unreachable',
    })

    const serverStore = useServerStore()
    const profile = await serverStore.add(newProfile())

    const store = useConnectionStore()
    const result = await store.connect(profile.id)

    expect(result).toBe(false)
    expect(store.state).toBe('unreachable')
    expect(store.lastError).toBeDefined()
  })

  it('transitions to auth_required when the server needs pairing', async () => {
    vi.spyOn(healthModule, 'checkServerHealth').mockResolvedValue({
      reachable: true,
      status: 'auth_required',
      statusCode: 401,
    })

    const serverStore = useServerStore()
    const profile = await serverStore.add(newProfile())

    const store = useConnectionStore()
    const result = await store.connect(profile.id)

    expect(result).toBe(false)
    expect(store.state).toBe('auth_required')
  })

  it('disconnect resets state', () => {
    const store = useConnectionStore()
    store.disconnect()
    expect(store.state).toBe('disconnected')
    expect(store.activeServerId).toBeNull()
    expect(store.lastError).toBeNull()
  })

  it('setFrameBlocked updates state', () => {
    const store = useConnectionStore()
    store.setFrameBlocked()
    expect(store.state).toBe('frame_blocked')
    expect(store.iframeLoadingFailed).toBe(true)
  })

  it('cancelReconnect stops reconnection', () => {
    const store = useConnectionStore()
    store.cancelReconnect()
    expect(store.state).toBe('disconnected')
  })
})
