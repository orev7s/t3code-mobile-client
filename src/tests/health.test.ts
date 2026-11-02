import { beforeEach, describe, expect, it, vi } from 'vitest'

const { capacitorHttpRequest, isNativePlatform } = vi.hoisted(() => ({
  capacitorHttpRequest: vi.fn(),
  isNativePlatform: vi.fn(() => true),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNativePlatform(),
  },
  CapacitorHttp: {
    request: capacitorHttpRequest,
  },
}))

import { checkServerHealth } from '@/services/t3code/health'

describe('checkServerHealth', () => {
  beforeEach(() => {
    capacitorHttpRequest.mockReset()
    isNativePlatform.mockReset()
    isNativePlatform.mockReturnValue(true)
  })

  it('reports connected for a reachable T3 Code server', async () => {
    capacitorHttpRequest.mockResolvedValueOnce({ status: 200 })

    const result = await checkServerHealth({
      baseUrl: 'http://localhost:3773',
      timeoutMs: 3500,
    })

    expect(capacitorHttpRequest).toHaveBeenNthCalledWith(1, expect.objectContaining({
      url: 'http://localhost:3773/',
      method: 'HEAD',
    }))
    expect(result).toEqual({
      reachable: true,
      status: 'connected',
      statusCode: 200,
    })
  })

  it('falls back to GET on native when HEAD rejects and preserves auth_required', async () => {
    capacitorHttpRequest
      .mockRejectedValueOnce(new Error('HEAD request failed'))
      .mockResolvedValueOnce({ status: 401 })

    const result = await checkServerHealth({
      baseUrl: 'http://localhost:3773',
      timeoutMs: 3500,
    })

    expect(capacitorHttpRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: 'http://localhost:3773/',
      method: 'GET',
    }))
    expect(result).toEqual({
      reachable: true,
      status: 'auth_required',
      statusCode: 401,
    })
  })

  it('reports unreachable when the request throws', async () => {
    capacitorHttpRequest.mockRejectedValue(new Error('connection refused'))

    const result = await checkServerHealth({ baseUrl: 'http://localhost:3773' })

    expect(result.reachable).toBe(false)
    expect(result.status).toBe('unreachable')
  })
})
