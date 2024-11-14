// Function to generate the MySQL SOUNDEX value in JavaScript
export function soundex(query: string): string {
	if (!query || query.length === 0) {
		return '0000';
	}

	const upperQuery = query.toUpperCase();
	const firstLetter = upperQuery.charAt(0).replace(/[^A-Z]/g, '');
	const rest = upperQuery.slice(1).replace(/[^A-Z]/g, '');

	let encoded =
		firstLetter +
		rest
			.replace(/[AEIOUYHW]/g, '0')
			.replace(/[BFPV]/g, '1')
			.replace(/[CGJKQSXZ]/g, '2')
			.replace(/[DT]/g, '3')
			.replace(/[L]/g, '4')
			.replace(/[MN]/g, '5')
			.replace(/[R]/g, '6');

	// Remove duplicates
	encoded = encoded.charAt(0) + encoded.slice(1).replace(/(.)\1+/g, '$1');

	// Remove all 0s and pad to ensure length is 4
	encoded = encoded.replace(/0/g, '').padEnd(4, '0').slice(0, 4);

	return encoded;
}
