const SEP = ' ';

export function packTorrinToken(baseUrl: string, apiKey: string): string {
	return `${baseUrl}${SEP}${apiKey}`;
}

export function splitTorrinToken(token: string): { baseUrl: string; apiKey: string } {
	const idx = token.indexOf(SEP);
	if (idx === -1) return { baseUrl: '', apiKey: token };
	return { baseUrl: token.slice(0, idx), apiKey: token.slice(idx + 1) };
}
