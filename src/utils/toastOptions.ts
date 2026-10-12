const globalToastOptions = {
	style: {
		borderRadius: '10px',
		background: 'rgba(255, 255, 0, 0.85)',
		color: '#000',
		fontSize: '1rem',
		padding: '0.1rem',
	},
};

export const searchToastOptions = {
	...globalToastOptions,
};

export const libraryToastOptions = {
	...globalToastOptions,
};

export const genericToastOptions = {
	...globalToastOptions,
};

export const magnetToastOptions = {
	...globalToastOptions,
};

export const castToastOptions = {
	...globalToastOptions,
};

/** Phones get toasts at the top: along the bottom they covered result buttons. */
export const toasterPosition = (): 'top-center' | 'bottom-right' =>
	typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)')?.matches
		? 'top-center'
		: 'bottom-right';
