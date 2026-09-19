import { type PremiumizeEnvelope } from './premiumize';

const PM_UPLOAD_URL = 'https://www.premiumize.me/api/transfer/create';

export interface PremiumizeUploadProxyResult {
	httpStatus: number;
	body: PremiumizeEnvelope;
}

/** Forwards an already-encoded multipart body byte-for-byte to Premiumize. */
export async function forwardPremiumizeTorrentUpload(
	apiKey: string,
	contentType: string,
	body: Uint8Array
): Promise<PremiumizeUploadProxyResult> {
	if (!apiKey) {
		return {
			httpStatus: 401,
			body: { status: 'error', code: 'authentication_failed', message: 'Missing API key.' },
		};
	}
	if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
		return {
			httpStatus: 415,
			body: {
				status: 'error',
				code: 'unsupported_media_type',
				message: 'Expected multipart data.',
			},
		};
	}

	try {
		const response = await fetch(PM_UPLOAD_URL, {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': contentType },
			body: body as BodyInit,
		});
		const responseType = (response.headers.get('content-type') || '').toLowerCase();
		if (!responseType.includes('application/json')) {
			return {
				httpStatus: response.status >= 400 ? response.status : 502,
				body: {
					status: 'error',
					code: 'non_json_response',
					message: `Premiumize answered ${response.status} with ${responseType || 'no content type'}`,
				},
			};
		}
		const parsed = (await response.json()) as PremiumizeEnvelope;
		return { httpStatus: response.status >= 400 ? response.status : 200, body: parsed };
	} catch (error) {
		return {
			httpStatus: 502,
			body: {
				status: 'error',
				code: 'transient_error',
				message: error instanceof Error ? error.message : 'Unknown error',
			},
		};
	}
}
