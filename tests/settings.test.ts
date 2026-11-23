import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { test } from "vite-plus/test";
import { MaterialStore } from "@/storage/materials.js";
import { loginViewer, viewerUrl } from "./viewer-session.js";

test("a proposed setting needs owner approval, evolves through review and can be withdrawn without losing the episode", async () => {
	const dir = mkdtempSync(join(tmpdir(), "settings-"));
	const scope = { space: "home", character: "reader", world: "real" };
	const config = { ...scope, database: join(dir, "db") };
	const runtime = join(dir, "runtime.json");
	writeFileSync(runtime, JSON.stringify(config));
	const store = new MaterialStore(config.database);
	const client = new Client({ name: "settings-test", version: "1" });
	const viewer = spawn(process.execPath, [resolve("dist/src/viewer.js"), runtime, "0"], {
		windowsHide: true,
		env: { ...process.env, HOME: dir, USERPROFILE: dir },
	});
	const closed = once(viewer, "close");
	try {
		const browser = await loginViewer(await viewerUrl(viewer.stdout));
		await browser.select();
		await client.connect(
			new StdioClientTransport({
				command: process.execPath,
				args: [resolve("dist/src/mcp-main.js"), runtime, "--no-webview"],
			}),
		);
		const call = async (name: string, args = {}) => {
			const response = await client.callTool({ name, arguments: args });
			assert.equal(response.isError, false, JSON.stringify(response.content));
			return JSON.parse((response.content as { text: string }[])[0]!.text);
		};
		const source = store.submit("client", scope, {
			operation_id: "meal",
			text: "我为朋友做晚餐。",
			source_kind: "character_statement",
			speaker: "我",
			coverage: "晚餐",
		}).material;
		const episode = store.reviewEpisode("client", scope, {
			operation_id: "dinner",
			base_seq: store.sequence(scope),
			title: "晚餐",
			summary: source.text,
			source_ids: [source.id],
			beats: [{ text: "做菜", source_ids: [source.id] }],
			interpretations: [],
			thread: null,
			activity_state: "completed",
			unknowns: [],
		}).episode;
		const proposal = {
			operation_id: "discover",
			base_seq: store.sequence(scope),
			setting: { target: "character", title: "爱好", body: "我喜欢做饭。" },
			reason: "主动为朋友做晚餐",
			episodes: [{ id: episode.id, revision: episode.revision }],
		};
		const first = (await call("memory_review", proposal)).change;
		assert.deepEqual((await call("memory_settings")).settings, []);
		assert.ok(
			(await (await browser.get("/reviews")).text()).includes("/traits/" + first.version),
		);
		const detail = await (await browser.get("/traits/" + first.version)).text();
		assert.ok(
			detail.includes("/episode/" + episode.id + "?rev=1") &&
				detail.includes(proposal.reason),
		);
		const selection = /name="selection" value="([^"]+)"/.exec(detail)![1]!;
		const act = (version: string, action: string) =>
			browser.post(
				"/traits/" + version,
				new URLSearchParams({ selection, action, mode: "autonomous" }),
			);
		assert.equal((await act(first.version, "approve")).status, 303);
		const revision = {
			...proposal,
			operation_id: "evolve",
			base_seq: store.sequence(scope),
			setting: {
				...proposal.setting,
				id: first.id,
				expected_version: first.version,
				body: "我喜欢为朋友做饭。",
			},
		};
		await call("memory_review", { ...revision, dry_run: true });
		assert.equal((await call("memory_settings")).settings[0].version, first.version);
		const next = (await call("memory_review", revision)).change;
		assert.equal((await call("memory_review", revision)).change.version, next.version);
		assert.equal((await call("memory_settings")).settings[0].body, revision.setting.body);
		assert.equal((await act(first.version, "undo")).status, 409);
		assert.equal((await act(next.version, "check")).status, 303);
		assert.equal((await act(next.version, "undo")).status, 303);
		const context = await call("memory_settings");
		assert.equal(context.settings[0].version, first.version);
		assert.equal(context.owner_decisions[0].version, next.version);
		assert.equal(
			(await call("memory_read", { kind: "episode", id: episode.id })).episode.summary,
			source.text,
		);

		const page = await (await browser.get("/traits")).text();
		const operation = /name="operation" value="([^"]+)"/.exec(page)![1]!;
		const form = new URLSearchParams({
			selection,
			operation,
			action: "save",
			target: "world",
			title: "节日",
			body: "每月十五聚餐。",
			mode: "owner",
		});
		assert.equal((await browser.post("/traits", form)).status, 303);
		const world = (await call("memory_settings")).settings.find(
			(s: { target: string }) => s.target === "world",
		);
		const request = {
			...proposal,
			operation_id: "new-festival",
			base_seq: store.sequence(scope),
			setting: {
				id: world.id,
				expected_version: world.version,
				target: "world",
				title: world.title,
				body: "改为每周聚餐。",
			},
		};
		const locked = (await call("memory_review", request)).change;
		assert.equal(locked.state, "proposed");
		assert.equal((await act(locked.version, "purge")).status, 409);
		assert.equal((await act(locked.version, "reject")).status, 303);
		const afterRejection = await call("memory_settings");
		assert.deepEqual(afterRejection.owner_decisions, context.owner_decisions);
		assert.deepEqual(
			afterRejection.settings.find((s: { id: string }) => s.id === world.id),
			world,
		);
		const rejectedPath = "/traits/" + locked.version;
		assert.ok((await (await browser.get("/reviews")).text()).includes(rejectedPath));
		const rejectedPage = await (await browser.get(rejectedPath)).text();
		assert.ok(
			rejectedPage.includes(request.setting.body) && rejectedPage.includes("确认永久删除"),
		);
		const retryRejected = async () => {
			const result = await client.callTool({ name: "memory_review", arguments: request });
			assert.equal(result.isError, true);
			assert.deepEqual(JSON.parse((result.content as { text: string }[])[0]!.text), {
				code: "NOT_FOUND",
			});
		};
		await retryRejected();
		const again = (
			await call("memory_review", {
				...request,
				operation_id: "reconsider-festival",
				base_seq: store.sequence(scope),
			})
		).change;
		assert.equal((await act(again.version, "reject")).status, 303);
		const purge = await act(locked.version, "purge");
		assert.equal(purge.status, 303);
		assert.equal(purge.headers.get("location"), "/reviews");
		assert.equal((await browser.get(rejectedPath)).status, 404);
		assert.ok(!(await (await browser.get("/reviews")).text()).includes(rejectedPath));
		await retryRejected();
		assert.ok(
			(await (await browser.get("/traits/" + again.version)).text()).includes(
				request.setting.body,
			),
		);
		assert.equal((await browser.get("/episode/" + episode.id)).status, 200);
		assert.deepEqual(
			store.settings.context({ ...config, world: "other" }).settings.map((r) => r.id),
			[first.id],
		);
		assert.equal((await act(first.version, "undo")).status, 303);
		const eventReview = store.reviews
			.list(scope, 0)
			.items.find((r) => r.episodeId === episode.id)!;
		assert.equal(store.reviews.act(scope, eventReview.key, "undo"), 303);
		const preview = await call("memory_preview_delete", { source_ids: [source.id] });
		assert.ok(preview.setting_versions.includes(first.version));
		assert.ok(!preview.setting_versions.includes(again.version));
		store.delete("client", scope, {
			source_ids: [source.id],
			operation_id: "erase",
			preview_token: preview.preview_token,
		});
		const remaining = await call("memory_settings");
		assert.equal((await browser.get("/traits/" + again.version)).status, 404);
		assert.equal(remaining.settings.length, 1);
		assert.equal(remaining.settings[0].version, world.version);
		assert.deepEqual(remaining.owner_decisions, []);
	} finally {
		viewer.kill();
		await closed;
		await client.close();
		store.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
