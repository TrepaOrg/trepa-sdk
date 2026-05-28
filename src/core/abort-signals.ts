export interface ComposedAbortSignal {
	readonly signal: AbortSignal;
	readonly cleanup: () => void;
}

const NOOP = (): void => {};

export function composeAbortSignals(
	a: AbortSignal | undefined | null,
	b: AbortSignal | undefined | null,
): ComposedAbortSignal {
	if (a?.aborted) {
		return { signal: AbortSignal.abort(a.reason), cleanup: NOOP };
	}
	if (b?.aborted) {
		return { signal: AbortSignal.abort(b.reason), cleanup: NOOP };
	}
	if (a && !b) return { signal: a, cleanup: NOOP };
	if (!a && b) return { signal: b, cleanup: NOOP };
	if (!a && !b) return { signal: new AbortController().signal, cleanup: NOOP };

	const parentA = a as AbortSignal;
	const parentB = b as AbortSignal;
	const controller = new AbortController();

	function cleanup(): void {
		parentA.removeEventListener('abort', onA);
		parentB.removeEventListener('abort', onB);
	}
	function onA(): void {
		cleanup();
		controller.abort(parentA.reason);
	}
	function onB(): void {
		cleanup();
		controller.abort(parentB.reason);
	}

	parentA.addEventListener('abort', onA, { once: true });
	parentB.addEventListener('abort', onB, { once: true });

	return { signal: controller.signal, cleanup };
}
