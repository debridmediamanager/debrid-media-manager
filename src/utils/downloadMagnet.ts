export const downloadMagnetFile = (hash: string) => {
	const magnetLink = `magnet:?xt=urn:btih:${hash}`;
	const blob = new Blob([magnetLink], { type: 'text/plain' });
	const url = window.URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${hash}.magnet`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	window.URL.revokeObjectURL(url);
};
