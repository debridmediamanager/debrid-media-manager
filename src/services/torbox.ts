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
		throw error;
    }
};

export const tbInstantCheck = async (apiKey: string, hashes: string[]) => {
    let endpoint = `${config.torboxHostname}/torrents/checkcached?format=list&list_files=true`
    for (const hash of hashes) {
        endpoint += `&hash=${hash}`;
    }
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