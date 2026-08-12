import { env } from '$env/dynamic/private';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

const connectionString = env.DATABASE_URL?.trim();

export const databaseEnabled = Boolean(connectionString);

let pool: Pool | undefined;

function createPool(): Pool {
	if (!connectionString) {
		throw new Error('DATABASE_URL is not configured.');
	}

	const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
	return new Pool({
		connectionString,
		max: 8,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
		ssl: isLocal
			? false
			: {
					rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
				}
	});
}

export function getPool(): Pool {
	pool ??= createPool();
	return pool;
}

export function query<Row extends QueryResultRow>(
	text: string,
	values: unknown[] = []
): Promise<QueryResult<Row>> {
	return getPool().query<Row>(text, values);
}

export async function withTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
	const client = await getPool().connect();
	try {
		await client.query('BEGIN');
		const result = await work(client);
		await client.query('COMMIT');
		return result;
	} catch (error) {
		await client.query('ROLLBACK');
		throw error;
	} finally {
		client.release();
	}
}
