export default function getReleaseTags(title: string, fileSize: number) {
	let remux = /remux|bdrip/i.test(title);
	let proper_remux = /\d\d\d\d.*\bproper\b/i.test(title);
	let dolby_vision = /\bDV\b|\bDoVi\b/i.test(title);
	let hdr10plus = /\bHDR10plus\b/i.test(title);
	let hdr = remux || dolby_vision || hdr10plus || /\bhdr\b|\bVISIONPLUSHDR\b/i.test(title);

	let score = fileSize;
	if (remux) score += 25;
	if (dolby_vision || hdr10plus) score += 15;
	if (hdr) score += 5;
	if (proper_remux) score += 2;

	return {
		dolby_vision,
		hdr10plus,
		hdr,
		remux,
		proper_remux,
		score,
	};
}
