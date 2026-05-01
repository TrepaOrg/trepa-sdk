import { config } from 'dotenv'

config()

export const requireEnv = (name: string): string => {
	const value = process.env[name]
	if (!value || value.trim() === '') {
		throw new Error(
			`Missing ${name}. Copy .env.example to .env and fill it in.`,
		)
	}
	return value
}

export const optionalEnv = (name: string, fallback: string): string => {
	const value = process.env[name]
	return value && value.trim() !== '' ? value : fallback
}
