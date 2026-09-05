import { buildInternalApiEndpoint } from '../../engines/chat-api/chatApiEndpoint';

export type AqiHomeAuthResult =
  | { ok: true }
  | { ok: false; errorType: 'access_key_required' | 'invalid_access_key' | 'unavailable' };

type AuthRequiredListener = () => void;

const authRequiredListeners = new Set<AuthRequiredListener>();

export function subscribeAqiHomeAuthRequired(listener: AuthRequiredListener) {
  authRequiredListeners.add(listener);
  return () => {
    authRequiredListeners.delete(listener);
  };
}

export function notifyAqiHomeAuthRequired() {
  for (const listener of authRequiredListeners) listener();
}

export async function authenticateAqiHome(
  accessKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<AqiHomeAuthResult> {
  if (!accessKey.trim()) {
    return { ok: false, errorType: 'access_key_required' };
  }

  try {
    const response = await fetchImpl(buildInternalApiEndpoint('/api/auth/session'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey })
    });

    if (response.ok) return { ok: true };
    if (response.status === 401) {
      return { ok: false, errorType: 'invalid_access_key' };
    }
    return { ok: false, errorType: 'unavailable' };
  } catch {
    return { ok: false, errorType: 'unavailable' };
  }
}
