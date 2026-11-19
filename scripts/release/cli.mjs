const commands = new Map([
	["setup", "./dist/setup.js"],
	["viewer:url", "./dist/viewer-url.js"],
	["index", "./dist/index.js"],
	["library", "./dist/library.js"],
]);
const [command] = process.argv.splice(2, 1);
const entry = commands.get(command);
if (entry) {
	await import(entry);
} else {
	console.error("用法：labradorite <setup|viewer:url|index|library> [参数]");
	process.exitCode = 1;
}
