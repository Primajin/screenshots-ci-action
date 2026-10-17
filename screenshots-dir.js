import {promises as fs} from 'node:fs';

// The directory the screenshots are written to. It must exist before the first
// capture: the sliced parts of a tall page are written with fs.writeFile, which
// does not create directories (running the action outside GitHub Actions,
// without GITHUB_WORKSPACE, used to fail with ENOENT).

/**
 Create the output directory, with its parents, when it does not exist yet.
 @param {string} directory The output directory.
 @returns {Promise<void>}
 */
async function ensureScreenshotsDir(directory) {
	await fs.mkdir(directory, {recursive: true});
}

/**
 List the files in the output directory.
 @param {string} directory The output directory.
 @returns {Promise<string[]>} The file names; empty when the directory is empty or does not exist.
 */
async function listScreenshots(directory) {
	try {
		return await fs.readdir(directory);
	} catch (error) {
		if (error.code === 'ENOENT') {
			return [];
		}

		throw error;
	}
}

export {ensureScreenshotsDir, listScreenshots};
