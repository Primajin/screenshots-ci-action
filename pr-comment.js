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
// of the token when it can be asked (a GITHUB_TOKEN cannot, so that is silent).
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

/**
 Find the action's earlier comment on a pull request.
 @param {object} octokit An authenticated octokit.
 @param {{owner: string, repo: string, issueNumber: number, marker: string, authors?: string[]}} options Where to look and what to look for.
 @returns {Promise<{id: number} | undefined>} The first comment written by an allowed author whose body starts with the marker.
 */
async function findPreviousComment(octokit, {owner, repo, issueNumber, marker, authors = [DEFAULT_BOT]}) {
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		owner,
		repo,
		issue_number: issueNumber,
		per_page: 100,
	});
	return comments.find(comment =>
		startsWithMarker(comment.body, marker)
		&& authors.includes(comment.user?.login),
	);
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
				// Deleted in the meantime or not editable: a new comment beats none
				log(`Could not update comment ${previous.id} (${error.message}); posting a new comment.`);
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

export {
	findPreviousComment, publishComment, resolveAuthors, startsWithMarker,
};
