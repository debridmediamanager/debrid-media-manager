/**
 * Fetch wrapper with retry logic for internal API calls
 * Matches the RealDebrid axios interceptor pattern:
 * - 7 max retries
 * - Exponential backoff with ±20% jitter
 * - 60s cap on delay
 * - Retries on 429 and 5xx errors
 * - Respects Retry-After header
 */

const MAX_RETRIES = 7;

// Delay function using MessageChannel to avoid browser throttling in background tabs
function delayWithMessageChannel(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper function to calculate exponential backoff delay with jitter
function calculateRetryDelay(retryCount: number, retryAfterHeader?: string | null): number {
	// If Retry-After header is present, use it
	if (retryAfterHeader) {
		const retryAfterSeconds = parseInt(retryAfterHeader, 10);
		if (!isNaN(retryAfterSeconds)) {
			return retryAfterSeconds * 1000;
		}
	}

	// Base delay: 1s, doubled each attempt (1s, 2s, 4s, 8s, 16s)
	const baseDelay = Math.pow(2, retryCount - 1) * 1000;

	// Cap at 60s first
	const cappedDelay = Math.min(baseDelay, 60000);

	// Add ±20% jitter to prevent thundering herd
	const jitterFactor = 0.8 + Math.random() * 0.4;
	const delayWithJitter = cappedDelay * jitterFactor;

	return delayWithJitter;
}

// Check if error is retryable (429 or 5xx)
function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status < 600);
}

export interface FetchWithRetryOptions extends RequestInit {
	maxRetries?: number;
}

/**
 * Fetch with automatic retry on 429 and 5xx errors
 * Uses exponential backoff with jitter, matching RealDebrid pattern
 */
export async function fetchWithRetry(
	url: string,
	options: FetchWithRetryOptions = {}
): Promise<Response> {
	const { maxRetries = MAX_RETRIES, ...fetchOptions } = options;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await fetch(url, fetchOptions);

			// If response is OK or not retryable, return it
			if (response.ok || !isRetryableStatus(response.status)) {
				return response;
			}

			// Retryable error - check if we have retries left
			if (attempt >= maxRetries) {
				return response; // Return the error response after max retries
			}

			// Calculate delay
			const retryAfter = response.headers.get('Retry-After');
			const delay = calculateRetryDelay(attempt + 1, retryAfter);

			const errorType = response.status === 429 ? 'rate limit' : 'server';
			console.log(
				`API request to ${url} failed with ${response.status} ${errorType} error. Retrying (attempt ${attempt + 1}/${maxRetries}) after ${Math.round(delay)}ms delay...`
			);

			await delayWithMessageChannel(delay);
		} catch (error) {
			// Network error - retry
			lastError = error as Error;

			if (attempt >= maxRetries) {
				throw lastError;
			}

			const delay = calculateRetryDelay(attempt + 1);
			console.log(
				`API request to ${url} failed with network error. Retrying (attempt ${attempt + 1}/${maxRetries}) after ${Math.round(delay)}ms delay...`
			);

			await delayWithMessageChannel(delay);
		}
	}

	// Should not reach here, but just in case
	throw lastError || new Error('Max retries exceeded');
}

/**
 * Fetch JSON with automatic retry on 429 and 5xx errors
 * Convenience wrapper that parses JSON response
 */
export async function fetchJsonWithRetry<T>(
	url: string,
	options: FetchWithRetryOptions = {}
): Promise<T> {
	const response = await fetchWithRetry(url, options);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`HTTP ${response.status}: ${errorText}`);
	}

	return response.json();
}
