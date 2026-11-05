import type { NextApiResponse } from 'next';

export class AllDebridApiError extends Error {
	readonly status: number;

	constructor(error: unknown) {
		const { status, errorMessage } = allDebridApiError(error);
		super(errorMessage);
		this.status = status;
	}
}

export function isInvalidAllDebridCredential(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	return (
		code === 'AUTH_BAD_APIKEY' || code === 'AUTH_MISSING_APIKEY' || code === 'AUTH_USER_BANNED'
	);
}

/** Only public, actionable messages: provider errors may contain credentials. */
export function allDebridApiError(error: unknown): { status: number; errorMessage: string } {
	const failure = error as {
		code?: unknown;
		response?: { status?: number; data?: unknown };
	} | null;
	if (failure?.code === 'AUTH_BLOCKED') {
		return {
			status: 403,
			errorMessage:
				'AllDebrid requires you to confirm the new sign-in email sent to your AllDebrid account. Confirm the email, then try again.',
		};
	}
	if (isInvalidAllDebridCredential(error)) {
		return { status: 401, errorMessage: 'Invalid AllDebrid API key' };
	}
	if (
		failure?.response?.status === 429 ||
		(failure?.response?.status === 503 && !failure.response.data)
	) {
		return {
			status: 503,
			errorMessage: 'AllDebrid is rate limiting requests. Please wait and try again.',
		};
	}
	return { status: 500, errorMessage: 'Internal server error' };
}

export function sendAllDebridApiError(error: unknown, res: NextApiResponse): void {
	const { status, errorMessage } = allDebridApiError(error);
	res.status(status).json({ status: 'error', errorMessage });
}
