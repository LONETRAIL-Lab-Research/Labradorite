import { validateEmbeddingConfig, type EmbeddingConfig } from "./providers/embedding.js";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

export interface RuntimeConfig {
	database: string;
	index_idle_minutes?: number;
	embedding?: EmbeddingConfig;
	local_model?: { file: string; sha256: string };
	space: string;
	character: string;
	world: string;
}

export const defaultIndexIdleMinutes = 120;

export function indexIdleMinutes(config: RuntimeConfig) {
	return config.index_idle_minutes ?? defaultIndexIdleMinutes;
}

export function withRuntimeConfigLock<T>(path: string, action: () => T): T {
	const lock = new Database(path + ".lock");
	try {
		return lock.transaction(action).immediate();
	} finally {
		lock.close();
	}
}

export function replaceRuntimeConfig(path: string, config: RuntimeConfig) {
	const temp = path + "." + randomUUID() + ".tmp";
	try {
		writeFileSync(temp, JSON.stringify(config, null, "\t") + "\n", { flag: "wx", mode: 0o600 });
		renameSync(temp, path);
	} finally {
		rmSync(temp, { force: true });
	}
}

// One-release migration. Setup and restore now write an explicit default on creation.
export function openRuntimeConfig(path: string): RuntimeConfig {
	const config = loadRuntimeConfig(path);
	if (config.index_idle_minutes !== undefined) return config;
	return withRuntimeConfigLock(path, () => {
		const current = loadRuntimeConfig(path);
		if (current.index_idle_minutes === undefined) {
			const installed =
				existsSync(current.database) || existsSync(join(dirname(path), "mcp.json"));
			current.index_idle_minutes = installed ? 0 : defaultIndexIdleMinutes;
			replaceRuntimeConfig(path, current);
		}
		return current;
	});
}

export function loadRuntimeConfig(path: string): RuntimeConfig {
	const value: unknown = JSON.parse(readFileSync(path, "utf8"));
	if (!value || typeof value !== "object") throw new Error("Invalid runtime configuration.");
	const config = value as Record<string, unknown>;
	for (const key of ["database", "space", "character", "world"]) {
		if (typeof config[key] !== "string") throw new Error("Invalid runtime configuration.");
	}
	if (
		Object.keys(config).some(
			(key) =>
				![
					"database",
					"space",
					"character",
					"world",
					"embedding",
					"local_model",
					"index_idle_minutes",
				].includes(key),
		)
	)
		throw new Error(
			"Unknown runtime configuration field. Regenerate the configuration for stdio MCP.",
		);
	const idle = config.index_idle_minutes;
	if (
		idle !== undefined &&
		(typeof idle !== "number" || !Number.isSafeInteger(idle) || idle < 0 || idle > 35791)
	)
		throw new Error("index_idle_minutes must be an integer between 0 and 35791 minutes.");
	if (!isAbsolute(config.database as string)) throw new Error("Database path must be absolute.");
	for (const key of ["space", "character", "world"]) {
		if (!/^[A-Za-z0-9_-]{1,128}$/.test(config[key] as string))
			throw new Error("Invalid scope.");
	}
	if (config.embedding !== undefined)
		config.embedding = validateEmbeddingConfig(config.embedding);
	if (config.local_model !== undefined) {
		const model = config.local_model as RuntimeConfig["local_model"];
		const embedding = config.embedding as EmbeddingConfig | undefined;
		if (
			!model ||
			typeof model.file !== "string" ||
			!isAbsolute(model.file) ||
			typeof model.sha256 !== "string" ||
			!/^[a-f0-9]{64}$/.test(model.sha256) ||
			embedding?.model !== "gguf-" + model.sha256 ||
			!/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/v1\/embeddings$/.test(embedding.endpoint) ||
			embedding.api_key_env ||
			embedding.request_dimensions
		)
			throw new Error("Invalid managed embedding configuration.");
	}
	return config as unknown as RuntimeConfig;
}
