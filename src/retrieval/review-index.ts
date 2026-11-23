import type { MaterialStore, MemoryScope } from "../storage/materials.js";
import { EmbeddingError } from "../providers/embedding.js";

import type { EpisodeRevision } from "./index.js";

type Outcome = { state: "completed" | "disabled" | "stopped"; reason?: string };

export class ReviewIndex {
	private timer?: NodeJS.Timeout;
	private active = 0;
	private closed = false;
	private job:
		| {
				controller: AbortController;
				idle: boolean;
				targeted: boolean;
				result: Promise<Outcome>;
		  }
		| undefined;

	constructor(
		private store: MaterialStore,
		private scope: MemoryScope,
		private enabled: boolean,
		private idleMinutes: number,
	) {
		this.arm();
	}

	begin() {
		this.active++;
		clearTimeout(this.timer);
		if (this.job?.idle) this.job.controller.abort();
	}

	end() {
		if (--this.active === 0) this.arm();
	}

	private arm() {
		if (!this.enabled || this.closed || this.idleMinutes === 0) return;
		this.timer = setTimeout(() => void this.run(true), this.idleMinutes * 60_000);
		this.timer.unref();
	}

	async finishReview(): Promise<Outcome | { state: "running" }> {
		let timer: NodeJS.Timeout | undefined;
		const waitingLimit = new Promise<{ state: "running" }>((resolve) => {
			timer = setTimeout(() => resolve({ state: "running" }), 1000);
		});
		try {
			return await Promise.race([this.run(), waitingLimit]);
		} finally {
			clearTimeout(timer);
		}
	}

	afterSave({ id, revision }: EpisodeRevision) {
		if (this.idleMinutes > 0) void this.run(false, { id, revision });
	}

	private async run(idle = false, episode?: EpisodeRevision): Promise<Outcome> {
		if (!this.enabled) return { state: "disabled" };
		if (this.closed) return { state: "stopped", reason: "INDEX_CANCELLED" };
		const idleTimer = this.timer;
		while (this.job) {
			if (!episode && !this.job.targeted && !this.job.controller.signal.aborted) {
				if (!idle) this.job.idle = false;
				return this.job.result;
			}
			await this.job.result;
			if (this.closed || (idle && (this.active || this.timer !== idleTimer)))
				return { state: "stopped", reason: "INDEX_CANCELLED" };
		}
		const controller = new AbortController();
		const result = this.drain(controller.signal, episode).finally(() => {
			this.job = undefined;
		});
		this.job = { controller, idle, targeted: !!episode, result };
		return result;
	}

	private async drain(signal: AbortSignal, episode?: EpisodeRevision): Promise<Outcome> {
		try {
			if (this.store.retrievalStatus(this.scope).pending_chunks) {
				const result = await this.store.indexAll(
					this.scope,
					episode ? { signal, episode } : { signal },
				);
				if (result.stopped) return { state: "stopped", reason: result.stopped };
			}
			return { state: "completed" };
		} catch (error) {
			return {
				state: "stopped",
				reason: error instanceof EmbeddingError ? error.code : "INDEX_FAILED",
			};
		}
	}

	async close() {
		this.closed = true;
		clearTimeout(this.timer);
		this.job?.controller.abort();
		await this.job?.result;
	}
}
