export const globalToastOptions = {
	style: {
		borderRadius: '10px',
		background: 'yellow',
		color: '#000',
		fontSize: '24px',
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
