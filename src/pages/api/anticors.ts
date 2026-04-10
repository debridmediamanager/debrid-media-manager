import {
	recordRdOperationEvent,
	resolveRealDebridOperation,
} from '@/lib/observability/rdOperationalStats';

import { randomUUID } from 'crypto';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { Agent, fetch as undiciFetch } from 'undici';

// Force IPv6 for upstream requests to avoid IPv4 rate limiting
// Global fetch ignores the dispatcher option; must use undici.fetch directly
const ipv6Dispatcher = new Agent({ connect: { family: 6 } });

// Origins allowed to use this cross-origin proxy
const ALLOWED_ORIGINS = [
	'http://127.0.0.1:3000',
	'http://localhost:3000',
	'https://debridmediamanager.com',
	'https://www.debridmediamanager.com',
];

const DEFAULT_ORIGIN = 'https://debridmediamanager.com';

const ALLOWED_HOSTS = [
	'app.real-debrid.com',
	'api.real-debrid.com',
	'api.alldebrid.com',
	'api.torbox.app',
];

const HEADERS_TO_PROXY = ['authorization', 'content-type'] as const;

const TEXTUAL_RESPONSE_HINTS = ['application/json', 'text/', 'application/xml'];

type HeadersToProxy = (typeof HEADERS_TO_PROXY)[number];

function getOrigin(req: NextApiRequest): string {
	const originHeader = req.headers.origin;
	if (typeof originHeader === 'string' && ALLOWED_ORIGINS.includes(originHeader)) {
		return originHeader;
	}
	return DEFAULT_ORIGIN;
}

function applyCorsHeaders(res: NextApiResponse, origin: string) {
	res.setHeader('Access-Control-Allow-Origin', origin);
	res.setHeader('Access-Control-Allow-Credentials', 'true');
	res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
	res.setHeader('Access-Control-Expose-Headers', 'x-total-count');
}

function handlePreflight(res: NextApiResponse, origin: string) {
	applyCorsHeaders(res, origin);
	res.setHeader('Access-Control-Max-Age', '86400');
	res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
	res.status(200).end();
}

function copyQueryParams(targetUrl: URL, query: NextApiRequest['query']) {
	Object.entries(query).forEach(([key, value]) => {
		if (key === 'url') {
			return;
		}

		if (Array.isArray(value)) {
			value.forEach((entry) => targetUrl.searchParams.append(key, entry));
		} else if (typeof value === 'string') {
			targetUrl.searchParams.append(key, value);
		}
	});
}

function buildProxyHeaders(req: NextApiRequest): Record<string, string> {
	const headers: Record<string, string> = {};
	HEADERS_TO_PROXY.forEach((header: HeadersToProxy) => {
		const value = req.headers[header];
		if (Array.isArray(value)) {
			if (value.length > 0) {
				headers[header] = value[0];
			}
		} else if (typeof value === 'string') {
			headers[header] = value;
		}
	});
	return headers;
}

async function readRequestBody(
	req: NextApiRequest,
	contentType: string | undefined
): Promise<BodyInit | undefined> {
	const normalizedType = contentType ? contentType.toLowerCase() : '';
	if (!['post', 'put', 'patch'].includes((req.method || '').toLowerCase()) || !normalizedType) {
		return undefined;
	}

	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
		chunks.push(bufferChunk);
	}

	if (!chunks.length) {
		return undefined;
	}

	const buffer = Buffer.concat(chunks);

	if (normalizedType.includes('application/json')) {
		const text = buffer.toString('utf-8');
		try {
			return JSON.stringify(JSON.parse(text));
		} catch (error) {
			throw new Error('Invalid JSON payload');
		}
	}

	if (
		normalizedType.includes('application/x-bittorrent') ||
		normalizedType.includes('application/octet-stream')
	) {
		return buffer;
	}

	return buffer.toString('utf-8');
}

async function buildResponseBody(
	response: Response,
	contentType: string
): Promise<string | Buffer> {
	const lowerContentType = contentType.toLowerCase();
	const shouldTreatAsText = TEXTUAL_RESPONSE_HINTS.some((hint) =>
		lowerContentType.includes(hint)
	);

	if (shouldTreatAsText) {
		return response.text();
	}

	const arrayBuffer = await response.arrayBuffer();
	return Buffer.from(arrayBuffer);
}

const handler: NextApiHandler = async (req: NextApiRequest, res: NextApiResponse) => {
	const origin = getOrigin(req);
	applyCorsHeaders(res, origin);

	if (req.method === 'OPTIONS') {
		handlePreflight(res, origin);
		return;
	}

	const urlParam = req.query.url;
	const proxyUrl = Array.isArray(urlParam) ? urlParam[0] : urlParam;
	if (!proxyUrl) {
		res.status(400).send('Bad request: Missing `url` query param');
		return;
	}

	let parsedProxyUrl: URL;
	try {
		parsedProxyUrl = new URL(proxyUrl);
	} catch (error) {
		res.status(400).send('Bad request: Invalid `url` query param');
		return;
	}

	if (!ALLOWED_HOSTS.includes(parsedProxyUrl.hostname)) {
		res.status(403).send('Host is not allowed');
		return;
	}

	parsedProxyUrl.searchParams.set('t', randomUUID());
	copyQueryParams(parsedProxyUrl, req.query);

	const proxyHeaders = buildProxyHeaders(req);
	const contentTypeHeader = proxyHeaders['content-type'];

	let requestBody: BodyInit | undefined;
	try {
		requestBody = await readRequestBody(req, contentTypeHeader);
	} catch (error) {
		res.status(500).send('Failed to read request body');
		return;
	}

	try {
		const upstreamResponse = (await undiciFetch(parsedProxyUrl.toString(), {
			method: req.method,
			headers: proxyHeaders,
			body: requestBody as any,
			dispatcher: ipv6Dispatcher,
		})) as unknown as Response;

		const responseContentType = upstreamResponse.headers.get('content-type') || '';
		const responseBody = await buildResponseBody(upstreamResponse, responseContentType);

		res.setHeader('Cache-Control', 'no-store, private');

		upstreamResponse.headers.forEach((value, key) => {
			const lowerKey = key.toLowerCase();
			if (
				lowerKey.startsWith('x-') ||
				lowerKey === 'content-length' ||
				lowerKey === 'content-type'
			) {
				res.setHeader(key, value);
			}
		});

		if (responseContentType) {
			res.setHeader('content-type', responseContentType);
		}

		res.status(upstreamResponse.status);
		res.send(responseBody);

		// Record tracked Real-Debrid operations
		const operation = resolveRealDebridOperation(req.method, parsedProxyUrl.pathname);
		if (
			operation &&
			(parsedProxyUrl.hostname === 'app.real-debrid.com' ||
				parsedProxyUrl.hostname === 'api.real-debrid.com')
		) {
			recordRdOperationEvent(operation, upstreamResponse.status);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown error';

		// Record failure for RD operations
		try {
			const operation = resolveRealDebridOperation(req.method, parsedProxyUrl.pathname);
			if (
				operation &&
				(parsedProxyUrl.hostname === 'app.real-debrid.com' ||
					parsedProxyUrl.hostname === 'api.real-debrid.com')
			) {
				recordRdOperationEvent(operation, 500);
			}
		} catch {}

		res.status(500).send(`Error fetching the proxy URL: ${message}`);
	}
};

export const config = {
	api: {
		bodyParser: false,
	},
};

export default handler;
