/**
 * Tiger Data (PostgreSQL + TimescaleDB) connection.
 *
 * Reads `DATABASE_URL` from the process environment so the same module works
 * inside the SvelteKit server *and* in the plain-node import scripts.
 *
 * `dotenv/config` matters here. SvelteKit's dev server loads .env into
 * `$env/dynamic/private` but not into `process.env`, so without this a local
 * .env is silently ignored and the app quietly falls back to the in-memory
 * store while looking like it is talking to Tiger Data. In production the
 * platform sets real environment variables and there is no .env file to find,
 * which makes this a harmless no-op.
 */

import 'dotenv/config';
import postgres from 'postgres';

export type StoreMode = 'tigerdata' | 'memory';

let client: postgres.Sql | null | undefined;

export function databaseUrl(): string | undefined {
	const url = process.env.DATABASE_URL?.trim();
	return url ? url : undefined;
}

export function getSql(): postgres.Sql | null {
	if (client !== undefined) return client;

	const url = databaseUrl();
	if (!url) {
		client = null;
		return null;
	}

	client = postgres(url, {
		// Tiger Data / Timescale Cloud always terminates TLS.
		ssl: /sslmode=disable/.test(url) ? false : 'require',
		max: 8,
		idle_timeout: 20,
		connect_timeout: 10,
		// Keep JSONB as parsed objects and timestamps as Date instances.
		transform: { undefined: null }
	});
	return client;
}

export async function closeSql(): Promise<void> {
	if (client) await client.end({ timeout: 5 });
	client = undefined;
}
