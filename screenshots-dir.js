import {promises as fs} from 'node:fs';
import path from 'node:path';

// The directory the screenshots are written to. It must exist before the first
// capture: the sliced parts of a tall page are written with fs.writeFile, which
// does not create directories (running the action outside GitHub Actions,
// without GITHUB_WORKSPACE, used to fail with ENOENT).
//
// The directory is shared by every call of the action in a job and is never
// emptied, but a call only uploads, comments and sends what it wrote itself:
// the files are tracked in memory (see createRunFiles).

/**
 Create the output directory, with its parents, when it does not exist yet.
 @param {string} directory The output directory.
 @returns {Promise<void>}
 */
async function ensureScreenshotsDir(directory) {
	await fs.mkdir(directory, {recursive: true});
}

/**
 Track the files this call of the action wrote into the output directory, so
 that a second call in the same job does not publish the first call's images
 again.
 @param {string} directory The output directory.
 @returns {{add: (paths: string[]) => void, names: () => string[]}} add() takes the paths takeScreenshot returned; names() the file names relative to the directory, in the order they were written, without duplicates. Paths outside the directory are ignored.
 */
function createRunFiles(directory) {
	const root = path.resolve(directory);
	const written = new Set();
	return {
		add(paths) {
			for (const file of paths) {
				const relative = path.relative(root, path.resolve(file));
				if (relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)) {
					written.add(relative);
				}
			}
		},
		names: () => [...written],
	};
}

export {createRunFiles, ensureScreenshotsDir};
