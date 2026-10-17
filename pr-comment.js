/* eslint-disable camelcase -- the GitHub REST API uses snake_case */
// Posts the screenshot comment: edits the action's earlier comment of the same
// tag (found by the hidden marker on its first line) or creates a new one.
// Only talks to the injected octokit, so it is unit tested with a fake.

const DEFAULT_BOT = 'github-actions[bot]';

// The comment starts with the marker line (a bare marker is fine too).
function startsWithMarker(body, marker) {
	return typeof body === 'string'
		&& (body === marker || body.startsWith(`${marker}\n`) || body.startsWith(`${marker}\r\n`));
}

// Logins whose comments may be edited: the default Actions bot, plus the owner
// of the token when it can be asked. A GITHUB_TOKEN and a GitHub App
// installation token cannot (GET /user answers 403, which is swallowed), so
// the comments of an App are recognised by their author type instead, see
// isOwnComment.
async function resolveAuthors(octokit) {
	const authors = [DEFAULT_BOT];
	try {
		const {data} = await octokit.rest.users.getAuthenticated();
		if (data?.login && !authors.includes(data.login)) {
			authors.push(data.login);
		}
	} catch {}

	return authors;
}

// A comment the action may have written: by a known login, or by any bot (an
// App token posts as "<app>[bot]", which cannot be looked up beforehand). It
// must carry the marker as well.
function isOwnComment(comment, marker, authors) {
	return startsWithMarker(comment.body, marker)
		&& (authors.includes(comment.user?.login) || comment.user?.type === 'Bot');
}

/**
 Find the action's earlier comment on a pull request.
 @param {object} octokit An authenticated octokit.
 @param {{owner: string, repo: string, issueNumber: number, marker: string, authors?: string[]}} options Where to look and what to look for.
 @returns {Promise<{id: number} | undefined>} The newest comment written by an allowed author (or a bot) whose body starts with the marker.
 */
async function findPreviousComment(octokit, {owner, repo, issueNumber, marker, authors = [DEFAULT_BOT]}) {
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		owner,
		repo,
		issue_number: issueNumber,
		per_page: 100,
	});
	// The newest one: when an old duplicate cannot be edited, the next run
	// still finds the comment that was posted last instead of adding more.
	return comments.findLast(comment => isOwnComment(comment, marker, authors));
}

/**
 Create the comment, or edit the previous one in `update` mode.
 @param {object} octokit An authenticated octokit.
 @param {{owner: string, repo: string, issueNumber: number, body: string, marker: string, mode: 'update' | 'new', log?: (message: string) => void}} options What to post.
 @returns {Promise<{action: 'created' | 'updated', id: number}>} What happened.
 */
async function publishComment(octokit, {owner, repo, issueNumber, body, marker, mode, log = console.log}) {
	if (mode === 'update') {
		const previous = await findPreviousComment(octokit, {
			owner,
			repo,
			issueNumber,
			marker,
			authors: await resolveAuthors(octokit),
		});
		if (previous) {
			try {
				const {data} = await octokit.rest.issues.updateComment({
					owner,
					repo,
					comment_id: previous.id,
					body,
				});
				return {action: 'updated', id: data?.id ?? previous.id};
			} catch (error) {
				// Only a comment that is gone (404) is replaced. Anything else (no
				// permission, rate limit, server error) would post a duplicate on
				// every run, so it is passed on.
				if (error.status !== 404) {
					throw error;
				}

				log(`Comment ${previous.id} no longer exists (${error.message}); posting a new comment.`);
			}
		}
	}

	const {data} = await octokit.rest.issues.createComment({
		owner,
		repo,
		issue_number: issueNumber,
		body,
	});
	return {action: 'created', id: data?.id};
}

/**
 Decide whether to upload the screenshots to the release, and say why not.
 Uploading needs the repository, a release and a token. Without a pull request
 there is nothing to comment on, so the upload only happens when no comment was
 asked for (`comment: false`, e.g. a push workflow).
 @param {{owner?: string, repo?: string, releaseId?: string, token?: string, pullRequest?: object, comment: boolean}} context What the run knows.
 @returns {{upload: boolean, notice?: string}} The decision and, when the user might expect a comment, a notice.
 */
function shouldUpload({owner, repo, releaseId, token, pullRequest, comment}) {
	if (!owner || !repo || !token) {
		return {upload: false};
	}

	if (!releaseId) {
		const notice = 'Nothing was uploaded or posted to the pull request: set "release-id" to post the screenshots (see README.PR.md).';
		return {upload: false, notice: comment && pullRequest ? notice : undefined};
	}

	return {upload: Boolean(pullRequest) || !comment};
}

export {
	findPreviousComment, isOwnComment, publishComment, resolveAuthors, shouldUpload, startsWithMarker,
};
