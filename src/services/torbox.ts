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