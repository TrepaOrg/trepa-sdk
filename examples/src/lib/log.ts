/* eslint-disable no-console */

/** Pretty-print a labelled JSON-serializable value to stdout. */
export const log = (label: string, value: unknown): void => {
	console.log(`\n# ${label}`)
	console.log(
		typeof value === 'string' ? value : JSON.stringify(value, null, 2),
	)
}

export const step = (message: string): void => {
	console.log(`\n--- ${message} ---`)
}
