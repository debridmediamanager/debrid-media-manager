import axios from 'axios';
import getConfig from 'next/config';

const { publicRuntimeConfig: config } = getConfig();

interface UserResponse {
    success: boolean;
    detail: string;
    error: string;
    data: {
        id: number;
        created_at: string;
        updated_at: string;
        email: string;
        plan: 0 | 1 | 2 | 3;
        total_downloaded: number;
        customer: string;
        is_subscribed: boolean;
        premium_expires_at: string;
        cooldown_until: string;
        auth_id: string;
        user_referral: string;
        base_emai: string;
    }
}

export const getTorBoxUser = async (apiKey: string) => {
    let endpoint = `${config.torboxHostname}/user/me`
    try {
        const userData = await axios.get<UserResponse>(endpoint, {
            headers: {
                "Authorization": `Bearer ${apiKey}`
            }
        })
        return userData.data.data
    } catch (error) {
        console.error('Error getting TorBox user data:', (error as any).message);
		throw new Error(`Failed to get TorBox user data: ${(error as any).message}`);
    }
};

export const tbInstantCheck = async (apiKey: string, hashes: string[]) => {
    const params = new URLSearchParams({ format: 'list', list_files: 'true' });
    hashes.forEach(hash => params.append('hash', hash));
    let endpoint = `${config.torboxHostname}/torrents/checkcached`
    try {
        const response = await axios.get(endpoint, {
            headers: {
                "Authorization": `Bearer ${apiKey}`
            }
        })
        return response.data.data
    } catch (error: any) {
        console.error('Error fetching magnet availability from TorBox: ', error.message);
        throw error;
    }
}

export const createTorBoxTorrent = async (apiKey: string, hashes: string[]) => {
    var allResponses = []
    try {
        for (let i = 0; i < hashes.length; i++) {
            let endpoint = `${config.torboxHostname}/torrents/createtorrent`;
            const response = await axios.post(endpoint, {
                magnet: `magnet:?xt=urn:btih:${hashes[i]}`
            }, {
                headers: {
                    "Content-Type": "multipart/form-data",
                    "Authorization": `Bearer ${apiKey}`
                },
                validateStatus: () => true
            });
            var responseData = response.data;
            if (responseData.error) {
                throw responseData.detail
            }
            allResponses.push(response.data)
        }
        return allResponses
    } catch (error) {
        console.error("Error creating torrent in TorBox:", (error as any).message)
        throw new Error(`Error creating torrent: ${responseData.detail}`);
    }
};

export const deleteTorBoxTorrent = async (apiKey: string, id: string) => {
	try {

        let endpoint = `${config.torboxHostname}/torrents/controltorrent`;
		await axios.post(endpoint, {
            torrent_id: id,
            operation: "delete"
        }, {
            headers: {
                "Authorization": `Bearer ${apiKey}`
            }
        })
	} catch (error: any) {
		console.error('Error deleting torrent from TorBox:', error.message);
		throw error;
	}
};

export const getTorBoxTorrents = async (
	apiKey: string,
    cacheBypass?: boolean,
	id?: string
) => {
	let endpoint = `${config.torboxHostname}/torrents/mylist`;
    if (cacheBypass) {
        endpoint += "&bypass_cache=true"
    }
	try {
		const response = await axios.get(endpoint, {
            headers: {
                "Authorization": `Bearer ${apiKey}`
            }
        });
		return response.data?.data;
	} catch (error) {
		console.error('Error fetching your TorBox torrents:', (error as any).message);
		throw error;
	}
};