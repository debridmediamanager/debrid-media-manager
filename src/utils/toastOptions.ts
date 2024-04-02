export const globalToastOptions = {
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
	icon: '🔍',
};

export const libraryToastOptions = {
	...globalToastOptions,
	icon: '📚',
};

export const genericToastOptions = {
	...globalToastOptions,
	icon: '📢',
};

export const magnetToastOptions = {
	...globalToastOptions,
	icon: '🧲',
};

export const castToastOptions = {
	...globalToastOptions,
	icon: '🪄',
};
