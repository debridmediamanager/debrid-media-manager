import type { PremiumizeEnvelope } from './premiumize';

const PM_UPLOAD_URL = 'https://www.premiumize.me/api/transfer/create';

export interface PremiumizeUploadProxyResult {
	httpStatus: number;
	body: PremiumizeEnvelope;
}

/** Streams an already-encoded multipart body to Premiumize without re-encoding it. */
export async function forwardPremiumizeTorrentUpload(
	apiKey: string,
	contentType: string,
	body: AsyncIterable<Uint8Array>
): Promise<PremiumizeUploadProxyResult> {
	if (!apiKey) {
		return {
			httpStatus: 401,
			body: { status: 'error', code: 'authentication_failed', message: 'Missing API key.' },
		};
	}
	if (
		!/^multipart\/form-data\s*;/i.test(contentType) ||
		!/;\s*boundary=(?:"[^"\r\n]+"|[^";\s]+)\s*(?:;|$)/i.test(contentType)
	) {
		return {
			httpStatus: 415,
			body: {
				status: 'error',
				code: 'unsupported_media_type',
				message: 'Expected multipart data with a boundary.',
			},
		};
	}

	try {
		// Node fetch requires duplex for streamed request bodies. Never follow a
		// redirect: the only permitted upload target is this fixed API endpoint.
		const request: RequestInit & { duplex: 'half' } = {
			method: 'POST',
			headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': contentType },
			body: body as unknown as BodyInit,
			duplex: 'half',
			redirect: 'error',
		};
		const response = await fetch(PM_UPLOAD_URL, request);
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
