export const envUrl = (value: string | undefined): string | undefined => {
	if (value === undefined) return undefined;
	const t = value.trim();
	return t === '' ? undefined : t;
};
