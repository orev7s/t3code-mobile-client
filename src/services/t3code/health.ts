import { Capacitor } from '@capacitor/core'
import type { HealthCheckResult, ServerStatus } from '@/types'
import { normalizeUrl } from './url'

interface HealthCheckOptions {
  baseUrl: string
  timeoutMs?: number
}

async function nativeRequest(url: string, timeoutMs: number): Promise<{ status: number }> {
  const { CapacitorHttp } = await import('@capacitor/core')
  const requestOptions = {
    url,
    connectTimeout: timeoutMs,
    readTimeout: timeoutMs,
  }

  try {
    const response = await (CapacitorHttp as any).request({
      ...requestOptions,
      method: 'HEAD',
    })
    return { status: response.status }
  } catch {
    // Some native HTTP stacks can reject HEAD 401/403 responses instead of
    // surfacing their status code. Retry with GET so an auth failure is not
    // collapsed into a generic offline/unreachable state.
    const response = await (CapacitorHttp as any).request({
      ...requestOptions,
      method: 'GET',
    })
    return { status: response.status }
  }
}

async function webRequest(url: string, timeoutMs: number): Promise<{ status: number }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      mode: 'cors',
    })
    return { status: response.status }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function makeRequest(url: string, timeoutMs: number): Promise<{ status: number }> {
  if (Capacitor.isNativePlatform()) {
    return nativeRequest(url, timeoutMs)
  }
  return webRequest(url, timeoutMs)
}

/**
 * T3 Code serves its web app from the server root, so a reachable server
 * answers on `/`. A 401/403 means the server is up but the device has not been
 * paired (or its grant was revoked).
 */
function classifyStatus(statusCode: number): ServerStatus {
  if (statusCode >= 200 && statusCode < 400) return 'connected'
  if (statusCode === 401 || statusCode === 403) return 'auth_required'
  return 'unreachable'
}

export async function checkServerHealth(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const { baseUrl, timeoutMs = 3500 } = options
  const normalized = normalizeUrl(baseUrl)
  const healthUrl = `${normalized}/`

  try {
    const { status } = await makeRequest(healthUrl, timeoutMs)
    const statusName = classifyStatus(status)

    return {
      reachable: statusName !== 'unreachable',
      status: statusName,
      statusCode: status,
    }
  } catch {
    return { reachable: false, status: 'unreachable' }
  }
}
