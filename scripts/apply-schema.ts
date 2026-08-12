import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
	throw new Error('DATABASE_URL is required.');
}

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const client = new Client({
	connectionString,
	ssl: isLocal
		? false
		: {
				rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false'
			}
});

try {
	await client.connect();
	const schema = await readFile(resolve('db/schema.sql'), 'utf8');
	await client.query(schema);
	console.log('Relief ATL database schema is ready.');
} finally {
	await client.end();
}
