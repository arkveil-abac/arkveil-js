type FetchWithRetryOptions = {
  timeout?: number;
  retryAttempts?: number;
};

/**
 * Status codes worth retrying: rate limiting and transient server errors.
 * Client errors (4xx, except 429) are not retried since they won't change.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Exponential backoff with jitter to avoid synchronized retry storms. */
function getBackoffDelay(attempt: number): number {
  return Math.pow(2, attempt) * 100 + Math.random() * 100;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { timeout = 5000, retryAttempts = 3 }: FetchWithRetryOptions = {},
  attempt = 1
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    // Network failures / timeouts (aborts) are retried.
    if (attempt < retryAttempts) {
      await delay(getBackoffDelay(attempt));
      return fetchWithRetry(url, options, { timeout, retryAttempts }, attempt + 1);
    }
    throw error;
  }

  clearTimeout(timeoutId);

  // Retry transient server errors / rate limiting before giving up.
  if (isRetryableStatus(response.status) && attempt < retryAttempts) {
    await delay(getBackoffDelay(attempt));
    return fetchWithRetry(url, options, { timeout, retryAttempts }, attempt + 1);
  }

  return response;
}
