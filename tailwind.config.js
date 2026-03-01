/** @type {import('tailwindcss').Config} */
module.exports = {
	content: [
		'./app/**/*.{js,ts,jsx,tsx}',
		'./pages/**/*.{js,ts,jsx,tsx}',
		'./components/**/*.{js,ts,jsx,tsx}',

		// Or if using `src` directory:
		'./src/**/*.{js,ts,jsx,tsx}',
	],
	theme: {
		extend: {
			boxShadow: {
				glow: '0 0 10px blue, 0 0 15px blue',
				'music-lg': '0 10px 25px -5px rgb(0 0 0 / 0.4)',
				'music-2xl': '0 25px 50px -12px rgb(0 0 0 / 0.6)',
			},
			keyframes: {
				'slide-up': {
					from: { opacity: '0', transform: 'translateY(16px)' },
					to: { opacity: '1', transform: 'translateY(0)' },
				},
			},
			animation: {
				'slide-up': 'slide-up 400ms cubic-bezier(0.34, 1.56, 0.64, 1)',
			},
		},
	},
	plugins: [],
};
