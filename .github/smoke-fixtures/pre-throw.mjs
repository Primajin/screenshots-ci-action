// Fails on purpose so the scenario can assert the action reports it.
export default async function throwingPreScript() {
	throw new Error('pre-script boom');
}
