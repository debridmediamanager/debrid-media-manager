// Linear congruential generator
export function lcg(seed: number) {
	return function () {
		seed = Math.imul(48271, seed) | (0 % 2147483647);
		// We discard the most significant bit to get a 0 to 2147483646 range
		if (seed < 0) seed += 2147483647;
		return seed / 2147483647;
	};
}

export function shuffle<T>(array: T[], rng: () => number) {
	let currentIndex = array.length,
		temporaryValue,
		randomIndex;

	// `> 0`, not `!== 0`: a non-array has no length, and NaN never reaches 0.
	while (currentIndex > 0) {
		randomIndex = Math.floor(rng() * currentIndex);
		currentIndex -= 1;

		temporaryValue = array[currentIndex];
		array[currentIndex] = array[randomIndex];
		array[randomIndex] = temporaryValue;
	}

	return array;
}
