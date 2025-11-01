type FetchWithRetryOptions = {
  timeout?: number;
  retryAttempts?: number;
};

export async function fetchWithRetry(
  url: string,
  options: RequestInit,
  { timeout = 5000, retryAttempts = 3 }: FetchWithRetryOptions = {},
  attempt = 1
): Promise<Response> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    if (attempt < retryAttempts) {
      // Exponential backoff
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 100)
      );
      return fetchWithRetry(
        url,
        options,
        { timeout, retryAttempts },
        attempt + 1
      );
    }
    throw error;
  }
}
