import useLocalStorage from '@/hooks/localStorage';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';


export default function TorBoxLoginPage() {
    const [apiKey, setApiKey] = useLocalStorage<string>('tb:apiKey');
    const [error, setError] = useState<string>();
    const router = useRouter();

    useEffect(() => {
		(async () => {
			if (apiKey) {
				await router.push('/');
			}
		})();
	}, [apiKey, router]);
    
    return (
		<div className="flex flex-col items-center justify-center h-screen">
			<Head>
				<title>Debrid Media Manager - TorBox Login</title>
			</Head>

            <form 
                className="flex flex-col items-center justify-center"
                onSubmit={(event) => {
                    event.preventDefault();
                    const submittedApiKey = event.target.apiKey.value.trim();

                    const apiKeyRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

                    let regexTest = apiKeyRegex.test(submittedApiKey);
                    
                    if (!regexTest) {
                        setError("Not a valid TorBox API key.")
                    } else {
                        setApiKey(submittedApiKey);
                    }
                }}
            >
                <img 
                    className="w-20 my-5"
                    src="https://torbox.app/logo.png"

                />
                <p className="mb-4 text-lg font-bold">
                    Please enter your TorBox API Key. You can find this <a href="https://torbox.app/settings" target="_blank" className="underline">here</a>.
                </p>
                <input
                    name="apiKey"
                    type="text"
                    className="px-4 py-2 rounded w-96 my-2 text-black"
                    placeholder="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                />
                {error && (
                    <span className="text-red-500 text-sm">{error}</span>
                )}
                <button
                    className="mt-4 px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-600 w-96"
                    type="submit"
                >
                    Submit TorBox API Key
                </button>
            </form>
		</div>
	);
}