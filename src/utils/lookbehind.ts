export function supportsLookbehind() {
	try {
		// Test a regex with a lookbehind assertion
		new RegExp('(?<=@)\\w+');

		// If no exception is thrown, lookbehind is supported
		return true;
	} catch (e) {
		// If an exception is thrown, lookbehind is not supported
		return false;
	}
}
