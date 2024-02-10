export function shortenNumber(num?: number): string {
	if (num === undefined) {
		return '';
	}
	if (num < 1000) {
		// For numbers less than 1000, we want to return the number with a maximum of one decimal place.
		return num.toFixed(1);
	} else if (num < 1000000) {
		// Divide by 1000 for thousands, remove decimal places.
		return (num / 1000).toFixed() + ' K';
	} else if (num < 1000000000) {
		// Divide by 1000000 for millions, remove decimal places.
		return (num / 1000000).toFixed() + ' M';
	} else if (num < 1000000000000) {
		// Use 'G' for billions, divide by 1000000000, remove decimal places.
		return (num / 1000000000).toFixed() + ' G';
	} else {
		// If the number is a trillion or more, just return the full number as a string.
		return num.toString();
	}
}
