import {openAsBlob} from 'node:fs';

const API_ROOT = 'https://api.telegram.org';
const MAX_GROUP_SIZE = 10;

const sleep = ms => new Promise(resolve => {
	setTimeout(resolve, ms);
});

// Calls a Telegram Bot API method with multipart/form-data and returns `result`.
// Throws when the HTTP request or the Bot API reports a failure.
async function callApi(token, method, form) {
	const response = await fetch(`${API_ROOT}/bot${token}/${method}`, {
		method: 'POST',
		body: form,
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok || !body.ok) {
		// The URL (which contains the token) is deliberately not part of the message.
		throw new Error(`Telegram ${method} failed: ${response.status} ${body.description ?? response.statusText}`);
	}

	return body.result;
}

async function sendPhoto({chatId, token, directory, fileName}) {
	const form = new FormData();
	form.set('chat_id', chatId);
	form.set('disable_notification', 'true');
	form.set('photo', await openAsBlob(`${directory}${fileName}`), fileName);
	return callApi(token, 'sendPhoto', form);
}

async function sendMediaGroup({chatId, token, directory, fileNames}) {
	const form = new FormData();
	form.set('chat_id', chatId);
	form.set('disable_notification', 'true');
	form.set('media', JSON.stringify(fileNames.map((fileName, index) => ({
		type: 'photo',
		caption: fileName,
		media: `attach://file${index}`,
	}))));
	for (const [index, fileName] of fileNames.entries()) {
		// eslint-disable-next-line no-await-in-loop
		form.set(`file${index}`, await openAsBlob(`${directory}${fileName}`), fileName);
	}

	return callApi(token, 'sendMediaGroup', form);
}

export default async function telegram({teleChatId, teltBotToken, files, path}) {
	try {
		const common = {chatId: teleChatId, token: teltBotToken, directory: path};
		let result = [];

		if (files.length === 1) {
			result = await sendPhoto({...common, fileName: files[0]});
		} else if (files.length > 1 && files.length <= MAX_GROUP_SIZE) {
			result = await sendMediaGroup({...common, fileNames: files});
		} else if (files.length > MAX_GROUP_SIZE) {
			for (let start = 0; start < files.length; start += MAX_GROUP_SIZE) {
				// eslint-disable-next-line no-await-in-loop
				result.push(await sendMediaGroup({...common, fileNames: files.slice(start, start + MAX_GROUP_SIZE)}));

				// https://core.telegram.org/bots/faq#my-bot-is-hitting-limits-how-do-i-avoid-this
				// Avoid sending more than one message per second in a chat, or 429 errors follow.
				// eslint-disable-next-line no-await-in-loop
				await sleep(2000);
			}
		}

		console.log(result);
	} catch (error) {
		console.error(error);
	}
}
