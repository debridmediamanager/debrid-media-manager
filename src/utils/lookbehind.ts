export function supportsLookbehind() {
	try {
		if ('$foo %foo foo'.replace(/(\$)foo/g, '$1bar') !== '$bar %foo foo') return false;
		if ('$foo %foo foo'.replace(/(?<=\$)foo/g, 'bar') !== '$bar %foo foo') return false;
		if ('$foo %foo foo'.replace(/(?<!\$)foo/g, 'bar') !== '$foo %bar bar') return false;
		return true;
	} catch (e) {
		// If an exception is thrown, lookbehind is not supported
		return false;
	}
}
