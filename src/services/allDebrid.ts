import axios from 'axios';
import getConfig from 'next/config';

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

interface PinCheckResponse {
	status: string;
	data: {
		activated: boolean;
		expires_in: number;
		apikey?: string;
	};
}

interface PinInfo {
	check_url: string;
}

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

const { publicRuntimeConfig: config } = getConfig();

export const getPin = async () => {
	try {
		const response = await axios.get<PinResponse>(`${config.allDebridHostname}/v4/pin/get`, {
			params: {
				agent: config.allDebridAgent,
			},
		});
		return response.data.data;
	} catch (error) {
		console.error('Error fetching PIN:', (error as any).message);
		throw error;
	}
};

export const checkPin = async (pin: string, check: string) => {
	const agent = config.allDebridAgent; // Your software user-agent.
	const apiEndpoint = `${config.allDebridHostname}/v4/pin/check?agent=${agent}&check=${check}&pin=${pin}`;

	try {
		let pinInfo = await axios.get<PinInfo>(apiEndpoint);
		let pinCheck = await axios.get<PinCheckResponse>(pinInfo.data.check_url);

		while (!pinCheck.data.data.activated) {
			await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds before polling again.
			pinCheck = await axios.get<PinCheckResponse>(pinInfo.data.check_url);
		}

		return pinCheck.data.data.apikey;
	} catch (error) {
		console.error('Error checking PIN:', (error as any).message);
		throw error;
	}
};

export const getUserInfo = async (apikey: string) => {
	const agent = config.allDebridAgent; // Your software user-agent.
	const apiEndpoint = `${config.allDebridHostname}/v4/user?agent=${agent}&apikey=${apikey}`;

	try {
		const response = await axios.get<UserResponse>(apiEndpoint);
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

export const uploadMagnet = async (apiKey: string, magnets: string[]) => {
	try {
		const queryParams = new URLSearchParams({
			agent: config.allDebridAgent,
			apikey: apiKey,
		});

		for (const magnet of magnets) {
			queryParams.append('magnets[]', magnet);
		}

		const response = await axios.post<MagnetUploadResponse>(
			`${config.allDebridHostname}/v4/magnet/upload?${queryParams.toString()}`
		);
		return response.data;
	} catch (error) {
		console.error('Error uploading magnet:', (error as any).message);
		throw error;
	}
};

interface MagnetStatus {
	id: number;
	filename: string;
	size: number;
	status: string;
	statusCode: number;
	downloaded: number;
	uploaded: number;
	seeders: number;
	downloadSpeed: number;
	uploadSpeed: number;
	uploadDate: number;
	completionDate: number;
	links: LinkObject[];
}

interface LinkObject {
	link: string;
	filename: string;
	size: number;
	files: { n: string; e?: { n: string }[] }[];
}

interface MagnetStatusResponse {
	magnets: MagnetStatus[];
	counter?: number;
	fullsync?: boolean;
}

export const getMagnetStatus = async (
	apiKey: string,
	magnetId?: number,
	statusFilter?: string,
	session?: number,
	counter?: number
): Promise<MagnetStatusResponse> => {
	const params: Record<string, string | number> = {
		agent: config.allDebridAgent,
		apikey: apiKey,
	};
	if (magnetId) {
		params.id = magnetId;
	} else if (statusFilter) {
		params.status = statusFilter;
	}
	if (session) {
		params.session = session;
	}
	if (counter) {
		params.counter = counter;
	}
	try {
		const response = await axios.get<MagnetStatusResponse>(
			`${config.allDebridHostname}/v4/magnet/status`,
			{
				params,
			}
		);
		return response.data;
	} catch (error) {
		console.error('Error fetching magnet status:', (error as any).message);
		throw error;
	}
};

interface MagnetDeleteResponse {
	message: string;
}

export const deleteMagnet = async (
	apikey: string,
	id: number,
	agent: string,
): Promise<MagnetDeleteResponse> => {
	try {
		const response = await axios.get<MagnetDeleteResponse>(
			`${config.allDebridHostname}/v4/magnet/delete`,
			{
				params: {
					id,
					agent,
					apikey,
				},
			}
		);
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

export const restartMagnet = async (
	apikey: string,
	id: number | number[],
	agent: string,
): Promise<MagnetRestartResponse> => {
	try {
		const response = await axios.get<MagnetRestartResponse>(
			`${config.allDebridHostname}/v4/magnet/restart`,
			{
				params: {
					id: id,
					ids: Array.isArray(id) ? id : undefined,
					agent,
					apikey,
				},
			}
		);
		return response.data;
	} catch (error) {
		console.error('Error restarting magnet:', (error as any).message);
		throw error;
	}
};

interface MagnetFile {
	n: string;
	s: number;
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

interface InstantAvailabilityResponse {
	magnets: MagnetData[];
}

export const getInstantAvailability = async (
	apiKey: string,
	magnets: string[]
): Promise<InstantAvailabilityResponse> => {
	try {
		const response = await axios.get<InstantAvailabilityResponse>(
			`${config.allDebridHostname}/v4/magnet/instant`,
			{
				params: {
					agent: config.allDebridAgent,
					apikey: apiKey,
					magnets: magnets,
				},
			}
		);
		return response.data;
	} catch (error: any) {
		console.error('Error fetching magnet availability:', error.message);
		throw error;
	}
};
