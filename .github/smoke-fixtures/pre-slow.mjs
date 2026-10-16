// Takes far longer than the pre-script timeout used by the failing scenario.
export default async function slowPreScript() {
	await new Promise(resolve => {
		setTimeout(resolve, 20_000);
	});
}
