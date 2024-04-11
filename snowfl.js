const axios = require('axios');

(async () => {
	const response = await axios.get('https://snowfl.com/index.html');
	const fileName = response.data.match(/src="(b\.min\.js\?[^"]+)"/)[1];
	console.log('script', `https://snowfl.com/${fileName}`);
	const script = await axios.get(`https://snowfl.com/${fileName}`);
	const token = script.data.match(/"([a-zA-Z0-9]+)";\$\(\(function\(\){var e,t,n,r,o,a,i=/)[1];
	console.log('token', token);
	const randomStr = Array.from(Array(8), () => Math.random().toString(36)[2]).join('');
	const timeMs = Date.now();
	for (let page = 0; page <= 10; page++) {
		const url = `https://snowfl.com/${token}/the%20boy%20and%20the%20heron%202023/${randomStr}/${page}/SEED/NONE/1?_=${
			timeMs + page
		}`;
		try {
			const jsonText = await axios.get(url);
            if (jsonText.data.length === 0) {
                throw 'no data found';
            }
            console.log('first item', jsonText.data[0].name)
			// Implement the processing of jsonText as needed
		} catch (error) {
			if (error.response && error.response.status === 404) {
				console.log('token expired')
			} else {
                console.log('error', error);
            }
            break;
		}
	}
})();
