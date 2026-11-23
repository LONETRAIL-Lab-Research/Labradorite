import { execFileSync } from "node:child_process";
import {
	copyFileSync,
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const windows = process.platform === "win32";
const platform = { win32: "windows", linux: "linux", darwin: "macos" }[process.platform];
if (!platform) throw new Error("请在 Windows、Linux 或 macOS 上构建便携包。");
const node = windows ? "node.exe" : "node";
const launcher = windows ? "labradorite.cmd" : "labradorite";
const root = fileURLToPath(new URL("../", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "labradorite-release-"));
const name = "Labradorite";
const app = join(work, name);
const archive = `Labradorite-${platform}-${process.arch}.zip`;
try {
	const install = join(work, "install");
	mkdirSync(install);
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	delete manifest.scripts;
	writeFileSync(join(install, "package.json"), JSON.stringify(manifest));
	copyFileSync(join(root, "pnpm-lock.yaml"), join(install, "pnpm-lock.yaml"));
	// A hoisted installation produces real directories when extracted by Windows Explorer.
	writeFileSync(join(install, "pnpm-workspace.yaml"), "nodeLinker: hoisted\n");
	execFileSync("vp", ["install", "--prod", "--frozen-lockfile"], {
		cwd: install,
		stdio: "inherit",
	});

	mkdirSync(app);
	const modules = join(install, "node_modules");
	if (existsSync(join(modules, ".pnpm", "node_modules")))
		throw new Error("发布包需要独立的 node_modules 目录。");
	renameSync(modules, join(app, "node_modules"));
	for (const file of [".bin", ".pnpm", ".modules.yaml", ".pnpm-workspace-state-v1.json"])
		rmSync(join(app, "node_modules", file), { recursive: true, force: true });
	cpSync(join(root, "dist"), join(app, "dist"), {
		recursive: true,
		filter: (path) => !path.endsWith(".map") && !path.endsWith(".zip"),
	});
	for (const file of [launcher, "cli.mjs"])
		copyFileSync(join(root, "scripts", "release", file), join(app, file));
	copyFileSync(process.execPath, join(app, node));
	const nodeRoot = windows ? dirname(process.execPath) : resolve(dirname(process.execPath), "..");
	copyFileSync(join(nodeRoot, "LICENSE"), join(app, "NODE-LICENSE.txt"));
	if (!windows) {
		chmodSync(join(app, launcher), 0o755);
		chmodSync(join(app, node), 0o755);
	}
	writeFileSync(join(app, "package.json"), JSON.stringify({ type: "module" }));
	cpSync(join(root, "docs"), join(app, "docs"), { recursive: true });
	copyFileSync(join(root, "README.md"), join(app, "README.md"));

	execFileSync(
		join(app, node),
		["-e", "require('better-sqlite3')(':memory:').close(); require('sharp')"],
		{
			cwd: app,
			stdio: "inherit",
		},
	);
	if (windows) execFileSync("tar.exe", ["-acf", archive, name], { cwd: work, stdio: "inherit" });
	else execFileSync("zip", ["-qr", archive, name], { cwd: work, stdio: "inherit" });
	const target = resolve(root, "dist", archive);
	copyFileSync(join(work, archive), target);
	console.info(target);
} finally {
	rmSync(work, { recursive: true, force: true });
}
