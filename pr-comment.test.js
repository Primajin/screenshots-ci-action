/* eslint-disable camelcase -- the GitHub REST API uses snake_case */
import {describe, expect, it} from 'vitest';
import {commentMarker} from './comment.js';
import {
	findPreviousComment,
	publishComment,
	resolveAuthors,
	startsWithMarker,
} from './pr-comment.js';

const marker = commentMarker('screenshots');
const BOT = 'github-actions[bot]';

// A fake octokit that keeps the comments of one issue in memory (paginate hands
// back all of them, like the real one after following the pages);
// `authenticated` is the login of the token (undefined: getAuthenticated is forbidden, like for a GITHUB_TOKEN).
function fakeOctokit({comments = [], authenticated, failUpdate} = {}) {
	const state = {comments: [...comments], calls: [], nextId: 1000};
	const listComments = {name: 'listComments'};
	return {
		state,
		async paginate(method, parameters) {
			state.calls.push(['paginate', method.name, parameters]);
			expect(method).toBe(listComments);
			return [...state.comments];
		},
		rest: {
			users: {
				async getAuthenticated() {
					if (!authenticated) {
						throw new Error('Resource not accessible by integration');
					}

					return {data: {login: authenticated}};
				},
			},
			issues: {
				listComments,
				async createComment(parameters) {
					state.calls.push(['create', parameters]);
					const comment = {id: state.nextId++, body: parameters.body, user: {login: BOT}};
					state.comments.push(comment);
					return {data: comment};
				},
				async updateComment(parameters) {
					state.calls.push(['update', parameters]);
					if (failUpdate) {
						throw new Error('Not Found');
					}

					const comment = state.comments.find(item => item.id === parameters.comment_id);
					comment.body = parameters.body;
					return {data: comment};
				},
			},
		},
	};
}

const comment = (id, body, login = BOT) => ({id, body, user: {login}});
const target = {owner: 'o', repo: 'r', issueNumber: 7};

describe('startsWithMarker', () => {
	it('matches the first line only', () => {
		expect(startsWithMarker(`${marker}\n### Screenshots`, marker)).toBe(true);
		expect(startsWithMarker(`${marker}\r\n### x`, marker)).toBe(true);
		expect(startsWithMarker(marker, marker)).toBe(true);
		expect(startsWithMarker(`text\n${marker}`, marker)).toBe(false);
		expect(startsWithMarker(`${marker}x`, marker)).toBe(false);
		expect(startsWithMarker(undefined, marker)).toBe(false);
		expect(startsWithMarker(null, marker)).toBe(false);
	});

	it('keeps tags apart, also when one is a prefix of the other', () => {
		const other = commentMarker('screenshots-2');
		expect(startsWithMarker(`${other}\nx`, marker)).toBe(false);
		expect(startsWithMarker(`${marker}\nx`, other)).toBe(false);
	});
});

describe('resolveAuthors', () => {
	it('is the Actions bot when the token cannot say who it is', async () => {
		expect(await resolveAuthors(fakeOctokit())).toEqual([BOT]);
	});

	it('adds the owner of a personal access token or app token', async () => {
		expect(await resolveAuthors(fakeOctokit({authenticated: 'jannis'}))).toEqual([BOT, 'jannis']);
		expect(await resolveAuthors(fakeOctokit({authenticated: BOT}))).toEqual([BOT]);
	});
});

describe('findPreviousComment', () => {
	it('finds the comment with the marker among others', async () => {
		const octokit = fakeOctokit({
			comments: [
				comment(1, 'a'),
				comment(2, 'b'),
				comment(3, 'c'),
				comment(4, 'd'),
				comment(5, `${marker}\nold`),
			],
		});
		expect(await findPreviousComment(octokit, {...target, marker})).toMatchObject({id: 5});
		expect(octokit.state.calls[0][2]).toEqual({
			owner: 'o',
			repo: 'r',
			issue_number: 7,
			per_page: 100,
		});
	});

	it('finds nothing without a marker comment', async () => {
		const octokit = fakeOctokit({comments: [comment(1, 'hello'), comment(2, commentMarker('other'))]});
		expect(await findPreviousComment(octokit, {...target, marker})).toBeUndefined();
		expect(await findPreviousComment(fakeOctokit(), {...target, marker})).toBeUndefined();
	});

	it('ignores comments of other authors, even with the marker', async () => {
		const octokit = fakeOctokit({
			comments: [comment(1, `${marker}\nfake`, 'mallory'), comment(2, `${marker}\nreal`)],
		});
		expect(await findPreviousComment(octokit, {...target, marker})).toMatchObject({id: 2});
		const onlyForeign = fakeOctokit({comments: [comment(1, `${marker}\nfake`, 'mallory')]});
		expect(await findPreviousComment(onlyForeign, {...target, marker})).toBeUndefined();
		expect(await findPreviousComment(onlyForeign, {...target, marker, authors: ['mallory']})).toMatchObject({id: 1});
	});

	it('takes the first of several matches', async () => {
		const octokit = fakeOctokit({comments: [comment(3, `${marker}\na`), comment(9, `${marker}\nb`)]});
		expect(await findPreviousComment(octokit, {...target, marker})).toMatchObject({id: 3});
	});

	it('copes with comments of deleted users', async () => {
		const octokit = fakeOctokit({comments: [{id: 1, body: `${marker}\nx`, user: null}]});
		expect(await findPreviousComment(octokit, {...target, marker})).toBeUndefined();
	});
});

describe('publishComment', () => {
	const body = `${marker}\n### Screenshots\n`;

	it('creates the comment when there is none (update mode)', async () => {
		const octokit = fakeOctokit({comments: [comment(1, 'unrelated')]});
		const result = await publishComment(octokit, {
			...target, body, marker, mode: 'update',
		});
		expect(result).toEqual({action: 'created', id: 1000});
		expect(octokit.state.comments).toHaveLength(2);
		expect(octokit.state.calls.at(-1)).toEqual(['create', {
			owner: 'o', repo: 'r', issue_number: 7, body,
		}]);
	});

	it('edits the earlier comment in update mode', async () => {
		const octokit = fakeOctokit({comments: [comment(1, 'unrelated'), comment(2, `${marker}\nold`)]});
		const result = await publishComment(octokit, {
			...target, body, marker, mode: 'update',
		});
		expect(result).toEqual({action: 'updated', id: 2});
		expect(octokit.state.comments).toHaveLength(2);
		expect(octokit.state.comments[1].body).toBe(body);
		expect(octokit.state.calls.at(-1)).toEqual(['update', {
			owner: 'o', repo: 'r', comment_id: 2, body,
		}]);
	});

	it('keeps exactly one comment when run twice', async () => {
		const octokit = fakeOctokit();
		const first = await publishComment(octokit, {
			...target, body, marker, mode: 'update',
		});
		const second = await publishComment(octokit, {
			...target, body: `${body}again`, marker, mode: 'update',
		});
		expect(first.action).toBe('created');
		expect(second).toEqual({action: 'updated', id: first.id});
		expect(octokit.state.comments).toHaveLength(1);
		expect(octokit.state.comments[0].body).toBe(`${body}again`);
	});

	it('keeps comments with different tags apart', async () => {
		const octokit = fakeOctokit();
		const links = commentMarker('links');
		await publishComment(octokit, {
			...target, body: `${marker}\none`, marker, mode: 'update',
		});
		await publishComment(octokit, {
			...target, body: `${links}\ntwo`, marker: links, mode: 'update',
		});
		await publishComment(octokit, {
			...target, body: `${marker}\nthree`, marker, mode: 'update',
		});
		expect(octokit.state.comments.map(item => item.body)).toEqual([`${marker}\nthree`, `${links}\ntwo`]);
	});

	it('always creates a new comment in new mode', async () => {
		const octokit = fakeOctokit({comments: [comment(2, `${marker}\nold`)]});
		const result = await publishComment(octokit, {
			...target, body, marker, mode: 'new',
		});
		expect(result.action).toBe('created');
		expect(octokit.state.comments).toHaveLength(2);
		// Does not even look for the earlier one
		expect(octokit.state.calls.map(call => call[0])).toEqual(['create']);
	});

	it('posts a new comment when the earlier one cannot be edited', async () => {
		const octokit = fakeOctokit({comments: [comment(2, `${marker}\nold`)], failUpdate: true});
		const messages = [];
		const result = await publishComment(octokit, {
			...target, body, marker, mode: 'update', log(message) {
				messages.push(message);
			},
		});
		expect(result.action).toBe('created');
		expect(messages).toEqual(['Could not update comment 2 (Not Found); posting a new comment.']);
	});

	it('edits a comment of the token owner too', async () => {
		const octokit = fakeOctokit({comments: [comment(4, `${marker}\nold`, 'jannis')], authenticated: 'jannis'});
		const result = await publishComment(octokit, {
			...target, body, marker, mode: 'update',
		});
		expect(result).toEqual({action: 'updated', id: 4});
	});
});
