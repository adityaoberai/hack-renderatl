import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required.');

const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
const client = new Client({
	connectionString,
	ssl: isLocal
		? false
		: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
});

try {
	await client.connect();
	const candidates = await client.query<{ id: string }>(
		`SELECT id
		 FROM restrooms
		 WHERE historically_accessible IS TRUE
		 ORDER BY source = 'gsu' DESC, name
		 LIMIT 3`
	);
	if (candidates.rows.length < 3) {
		throw new Error(
			'Import at least three historically accessible restrooms before seeding reports.'
		);
	}

	const recentSeed = await client.query<{ exists: boolean }>(
		`SELECT EXISTS (
			SELECT 1
			FROM reports
			WHERE metadata ->> 'seed' = 'hackathon-demo'
			  AND created_at > NOW() - INTERVAL '1 hour'
		) AS exists`
	);
	if (recentSeed.rows[0]?.exists) {
		console.log('Fresh demo reports already exist; no new events were added.');
	} else {
		await client.query(
			`INSERT INTO reports (restroom_id, status, created_at, metadata)
			 VALUES
				($1, 'accessible', NOW() - INTERVAL '18 minutes', '{"seed":"hackathon-demo"}'),
				($1, 'accessible', NOW() - INTERVAL '31 days', '{"seed":"hackathon-demo"}'),
				($2, 'locked', NOW() - INTERVAL '12 minutes', '{"seed":"hackathon-demo"}'),
				($3, 'accessible', NOW() - INTERVAL '2 hours', '{"seed":"hackathon-demo"}')`,
			[candidates.rows[0].id, candidates.rows[1].id, candidates.rows[2].id]
		);
		console.log('Added four timestamped demo events to real restroom locations.');
	}
} finally {
	await client.end();
}
