import {readFileSync} from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';

// Keeps action.yml, the env mapping of its step and the inputs tables of the
// README in step: a new input that is forgotten in one of them fails here.

const root = import.meta.dirname;
const read = file => readFileSync(path.join(root, file), 'utf8');
const actionYml = read('action.yml');
const readme = read('README.md');

// {name -> {defaultValue, hasDefault}} from the `inputs:` block of action.yml
function parseInputs(yml) {
	const block = yml.slice(yml.indexOf('\ninputs:\n') + 1, yml.indexOf('\nruns:\n'));
	const inputs = new Map();
	let current;
	for (const line of block.split('\n')) {
		const name = /^ {2}(?<name>[\-a-z]+):\s*$/v.exec(line)?.groups.name;
		if (name) {
			current = {required: false};
			inputs.set(name, current);
			continue;
		}

		const field = /^ {4}(?<key>required|default): (?<value>.*)$/v.exec(line);
		if (!current || !field) {
			continue;
		}

		const value = field.groups.value.trim().replace(/^(?<quote>["'])(?<inner>.*)\k<quote>$/v, '$<inner>');
		if (field.groups.key === 'required') {
			current.required = value === 'true';
		} else {
			current.default = value;
		}
	}

	return inputs;
}

// {name -> default cell} from the README tables whose rows look like | `name` | `default` | ... |
function parseReadmeInputs(markdown) {
	const section = markdown.slice(markdown.indexOf('\n## Inputs\n'), markdown.indexOf('\n## Environment variables\n'));
	const rows = new Map();
	for (const line of section.split('\n')) {
		const match = /^\| `(?<name>[\-a-z]+)` \| (?<default>[^\|]+) \|/v.exec(line);
		if (match) {
			rows.set(match.groups.name, match.groups.default.trim());
		}
	}

	return rows;
}

const inputs = parseInputs(actionYml);
const documented = parseReadmeInputs(readme);

describe('action.yml and the README', () => {
	it('reads the inputs of action.yml', () => {
		expect(inputs.size).toBeGreaterThan(20);
		expect(inputs.get('url')).toEqual({required: true});
		expect(inputs.get('type')).toEqual({required: false, default: 'jpeg'});
	});

	it('documents every input in the inputs tables, and nothing else', () => {
		expect(documented.keys().toArray().toSorted((a, b) => a.localeCompare(b)))
			.toEqual(inputs.keys().toArray().toSorted((a, b) => a.localeCompare(b)));
	});

	it('documents the default of every input like action.yml has it', () => {
		for (const [name, input] of inputs) {
			const cell = documented.get(name);
			if (input.required) {
				expect(cell, name).toBe('**required**');
				continue;
			}

			const expected = input.default === '' ? '`\'\'`' : `\`${input.default}\``;
			expect(cell, name).toBe(expected);
		}
	});

	it('hands every input to the script as INPUT_<NAME>, the pre-script ones under their own names', () => {
		const step = actionYml.slice(actionYml.indexOf('- name: Take screenshots'));
		const mapped = new Map(step.matchAll(/^ {8}(?<variable>[\w\-]+): \$\{\{ inputs\.(?<input>[\-a-z]+) \}\}$/gmv)
			.map(match => [match.groups.input, match.groups.variable]));
		expect(mapped.keys().toArray().toSorted((a, b) => a.localeCompare(b)))
			.toEqual(inputs.keys().toArray().toSorted((a, b) => a.localeCompare(b)));
		for (const [input, variable] of mapped) {
			const own = {'pre-script-path': 'PRE_SCRIPT_PATH', 'pre-script-timeout': 'PRE_SCRIPT_TIMEOUT'}[input];
			expect(variable, input).toBe(own ?? `INPUT_${input.toUpperCase()}`);
		}
	});

	it('has a description for every input', () => {
		const block = actionYml.slice(actionYml.indexOf('\ninputs:\n'), actionYml.indexOf('\nruns:\n'));
		expect(block.match(/^ {4}description:/gmv)).toHaveLength(inputs.size);
	});
});
