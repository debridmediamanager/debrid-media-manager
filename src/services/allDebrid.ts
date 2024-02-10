import axios from 'axios';
import getConfig from 'next/config';

const { publicRuntimeConfig: config } = getConfig();

interface PinResponse {
	status: string;
	data: {
		pin: string;
		check: string;
		expires_in: number;
		user_url: string;
		base_url: string;
		check_url: string;
	};
}

export const getPin = async () => {
	try {
		let endpoint = `${config.allDebridHostname}/v4/pin/get?agent=${config.allDebridAgent}`;
		const response = await axios.get<PinResponse>(endpoint);
		return response.data.data;
	} catch (error) {
		console.error('Error fetching PIN:', (error as any).message);
		throw error;
	}
};

interface PinCheckResponse {
	status: string;
	data: {
		activated: boolean;
		expires_in: number;
		apikey?: string;
	};
}

export const checkPin = async (pin: string, check: string) => {
	let endpoint = `${config.allDebridHostname}/v4/pin/check?agent=${config.allDebridAgent}&check=${check}&pin=${pin}`;
	try {
		let pinCheck = await axios.get<PinCheckResponse>(endpoint);

		while (!pinCheck.data.data.activated) {
			await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before polling again.
			pinCheck = await axios.get<PinCheckResponse>(endpoint);
		}

		return pinCheck.data;
	} catch (error) {
		console.error('Error checking PIN:', (error as any).message);
		throw error;
	}
};

interface UserResponse {
	status: string;
	data: {
		user: {
			username: string;
			email: string;
			isPremium: boolean;
			isSubscribed: boolean;
			isTrial: boolean;
			premiumUntil: number;
			lang: string;
			preferedDomain: string;
			fidelityPoints: number;
			limitedHostersQuotas: Record<string, number>;
			remainingTrialQuota?: number;
			notifications: string[];
		};
	};
}

export const getAllDebridUser = async (apikey: string) => {
	let endpoint = `${config.allDebridHostname}/v4/user?agent=${config.allDebridAgent}&apikey=${apikey}`;
	try {
		const response = await axios.get<UserResponse>(endpoint);
		return response.data.data.user;
	} catch (error) {
		console.error('Error fetching user info:', (error as any).message);
		throw error;
	}
};

interface MagnetObject {
	magnet: string;
	name?: string;
	id?: number;
	hash?: string;
	size?: number;
	ready?: boolean;
	error?: {
		code: string;
		message: string;
	};
}

interface MagnetUploadResponse {
	status: string;
	data: {
		magnets: MagnetObject[];
	};
}

export const uploadMagnet = async (apikey: string, hashes: string[]) => {
	try {
		let endpoint = `${config.allDebridHostname}/v4/magnet/upload?agent=${config.allDebridAgent}&apikey=${apikey}`;
		for (const hash of hashes) {
			endpoint += `&magnets[]=${hash}`;
		}
		const response = await axios.post<MagnetUploadResponse>(endpoint);
		return response.data;
	} catch (error) {
		console.error('Error uploading magnet:', (error as any).message);
		throw error;
	}
};

export interface MagnetStatus {
	id: number;
	filename: string;
	size: number;
	hash: string;
	status: string;
	statusCode: number;
	downloaded: number;
	uploaded: number;
	processingPerc: number;
	seeders: number;
	downloadSpeed: number;
	uploadSpeed: number;
	uploadDate: number;
	completionDate: number;
	links: LinkObject[];
	type: string;
	notified: boolean;
	version: number;
}

interface LinkObject {
	link: string;
	filename: string;
	size: number;
	files: { n: string; s?: number }[];
}

interface MagnetStatusResponse {
	status: string;
	data: {
		magnets: MagnetStatus[];
	};
}

export const getMagnetStatus = async (
	apikey: string,
	magnetId?: string,
	statusFilter?: string,
	session?: number,
	counter?: number
): Promise<MagnetStatusResponse> => {
	let endpoint = `${config.allDebridHostname}/v4/magnet/status?agent=${config.allDebridAgent}&apikey=${apikey}`;
	if (magnetId) {
		endpoint += `&id=${magnetId}`;
	} else if (statusFilter) {
		endpoint += `&status=${statusFilter}`;
	}
	if (session) {
		endpoint += `&session=${session}`;
	}
	if (counter) {
		endpoint += `&counter=${counter}`;
	}
	try {
		const response = await axios.get<MagnetStatusResponse>(endpoint);
		return response.data;
	} catch (error) {
		console.error('Error fetching magnet status:', (error as any).message);
		throw error;
	}
};

interface MagnetDeleteResponse {
	message: string;
}

export const deleteMagnet = async (apikey: string, id: string): Promise<MagnetDeleteResponse> => {
	let endpoint = `${config.allDebridHostname}/v4/magnet/delete?agent=${config.allDebridAgent}&apikey=${apikey}&id=${id}`;
	try {
		const response = await axios.get<MagnetDeleteResponse>(endpoint);
		return response.data;
	} catch (error) {
		console.error('Error deleting magnet:', (error as any).message);
		throw error;
	}
};

interface MagnetRestartResponse {
	message?: string;
	error?: {
		code: string;
		message: string;
	};
	magnet?: number | string;
}

export const restartMagnet = async (apikey: string, id: string): Promise<MagnetRestartResponse> => {
	let endpoint = `${config.allDebridHostname}/v4/magnet/restart?agent=${config.allDebridAgent}&apikey=${apikey}&id=${id}`;
	try {
		const response = await axios.get<MagnetRestartResponse>(endpoint);
		if (response.data.error) throw new Error(response.data.error.message);
		return response.data;
	} catch (error) {
		console.error('Error restarting magnet:', (error as any).message);
		throw error;
	}
};

export interface MagnetFile {
	n: string;
	s: number;
	e?: MagnetFile[];
}

interface MagnetData {
	magnet: string;
	hash: string;
	instant: boolean;
	files?: MagnetFile[];
	error?: {
		code: string;
		message: string;
	};
}

export interface AdInstantAvailabilityResponse {
	status: string;
	data: { magnets: MagnetData[] };
}

export const adInstantCheck = async (
	apikey: string,
	hashes: string[]
): Promise<AdInstantAvailabilityResponse> => {
	let endpoint = `${config.allDebridHostname}/v4/magnet/instant?agent=${config.allDebridAgent}&apikey=${apikey}`;
	for (const hash of hashes) {
		endpoint += `&magnets[]=${hash}`;
	}
	try {
		const response = await axios.get<AdInstantAvailabilityResponse>(endpoint);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching magnet availability:', error.message);
		throw error;
	}
};
