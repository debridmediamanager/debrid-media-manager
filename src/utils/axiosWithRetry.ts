/**
 * Axios instance with retry logic for internal API calls
 * Matches the RealDebrid axios interceptor pattern:
 * - 7 max retries
 * - Exponential backoff with ±20% jitter
 * - 60s cap on delay
 * - Retries on 429 and 5xx errors
 * - Respects Retry-After header
 */

import { delay as delayWithMessageChannel } from '@/utils/delay';
import axios, { InternalAxiosRequestConfig } from 'axios';

const MAX_RETRIES = 7;
const REQUEST_TIMEOUT = 30000; // 30s timeout for internal API

// Extend the Axios request config type to include our custom properties
interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
	__isRetryRequest?: boolean;
	__retryCount?: number;
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

// Create a global axios instance for internal API requests
const axiosWithRetry = axios.create({
	timeout: REQUEST_TIMEOUT,
});

// Add response interceptor for handling retries with exponential backoff
axiosWithRetry.interceptors.response.use(
	(response) => response,
	async (error) => {
		const originalConfig = error.config as ExtendedAxiosRequestConfig;

		if (!originalConfig) {
			return Promise.reject(error);
		}

		if (originalConfig.__retryCount === undefined) {
			originalConfig.__retryCount = 0;
		}

		// Max 7 retries
		if (originalConfig.__retryCount >= MAX_RETRIES) {
			return Promise.reject(error);
		}

		// Retry on 5xx server errors OR 429 rate limit errors
		const status = error.response?.status;
		const shouldRetry = (status >= 500 && status < 600) || status === 429;

		if (!shouldRetry) {
			return Promise.reject(error);
		}

		originalConfig.__retryCount++;
		originalConfig.__isRetryRequest = true;

		// Get Retry-After header if present
		const retryAfter = error.response?.headers?.['retry-after'];
		const delay = calculateRetryDelay(originalConfig.__retryCount, retryAfter);

		const errorType = error.response?.status === 429 ? 'rate limit' : 'server';
		console.log(
			`Internal API request failed with ${error.response?.status} ${errorType} error. Retrying (attempt ${originalConfig.__retryCount}/${MAX_RETRIES}) after ${Math.round(delay)}ms delay...`
		);

		await delayWithMessageChannel(delay);

		try {
			return await axiosWithRetry.request(originalConfig);
		} catch (retryError) {
			return Promise.reject(retryError);
		}
	}
);

export default axiosWithRetry;
