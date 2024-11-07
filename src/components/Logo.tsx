import React from 'react';

export const Logo: React.FC = () => (
	<svg className="h-24 w-24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
		<rect x="25" y="25" width="150" height="150" fill="#2C3E50" rx="20" ry="20" />
		<circle cx="100" cy="100" r="60" fill="#00A0B0" />
		<path d="M85,65 L85,135 L135,100 Z" fill="#ECF0F1" />
		<path d="M60,90 Q80,60 100,90 T140,90" fill="#CC333F" />
		<path d="M75,121 L80,151 L90,136 L100,151 L110,136 L120,151 L125,121 Z" fill="#EDC951" />
	</svg>
);
