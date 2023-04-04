import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';

export type apiResult = {
	hashListId?: string;
	errorMessage?: string;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse<apiResult>) {
	res.status(200).json({ hashListId: uuidv4() });
}
