# Relief ATL

Relief ATL helps people find an Atlanta restroom they can actually use. It combines public
restroom records with timestamped community confirmations, ranks nearby options by both
distance and access confidence, and keeps every report as an immutable availability event.

## Stack

- SvelteKit 2, Svelte 5, and TypeScript
- Tailwind CSS 4
- MapLibre GL JS with OpenStreetMap raster tiles
- Tiger Data / PostgreSQL with a Timescale hypertable for reports
- SvelteKit server routes for all data access
- `adapter-node` and a production Dockerfile for DigitalOcean

## Local development

```sh
npm install
cp .env.example .env
npm run dev
```

Without `DATABASE_URL`, the app starts in transparent demo mode. It uses a small set of real
Atlanta civic destinations with unknown restroom attributes left as `null`, plus mock
timestamped reports that are recalculated relative to server startup. Demo reports are held in
memory and reset when the server restarts.

With `DATABASE_URL`, Tiger Data is the system of record and the demo fallback is disabled.

## Tiger Data setup

Create a Tiger Data service, copy its PostgreSQL connection string into `.env`, then run:

```sh
npm run db:schema
npm run db:import:gsu
npm run db:import:osm
npm run db:seed:reports
```

`db/schema.sql` creates:

- `restrooms`, including source provenance and preserved `source_metadata`
- `reports`, with a composite time-aware primary key
- a Timescale hypertable on `reports.created_at`
- source, coordinate, and recent-report indexes

TLS certificate verification is enabled for hosted databases. Only set
`DATABASE_SSL_REJECT_UNAUTHORIZED=false` when using a trusted local proxy.

## GSU / OSF importer

The authoritative seed is the public dataset for:

> Shackelford et al. (2026), “Public bathrooms as public goods: Assessing availability and
> accessibility in Atlanta, Georgia,” PLOS Water.

The importer:

1. Discovers files from the public OSF API at
   `https://api.osf.io/v2/nodes/fm9by/files/osfstorage/`.
2. Prints every actual filename, worksheet, header, and row count before mapping.
3. Parses CSV, TSV, JSON, and XLSX files.
4. Selects location tables only when a safe combination of location and audit fields exists.
5. Maps explicitly recognized fields and leaves unrecognized or missing values as `null`.
6. Preserves the complete original row in `source_metadata.raw`.
7. assigns `source = 'gsu'`, a stable source ID, and a traceable OSF download URL.
8. Upserts idempotently on `(source, source_id)`.

Useful options:

```sh
# Choose a specific discovered filename
npm run db:import:gsu -- --file location

# Geocode only rows whose source data lacks coordinates
npm run db:import:gsu -- --geocode

# Persist a normalized copy for database-free demos
npm run db:import:gsu -- --write-seed

# Deliberately import a partial source after reviewing the printed count
npm run db:import:gsu -- --allow-partial
```

The importer fails with printed headers instead of guessing when the source schema does not
match a safe alias. Extend `HEADER_ALIASES` only after comparing it with those printed source
headers.

The checked-in `gsu-restrooms.json` is intentionally replaced only by `--write-seed`; this
prevents generated or invented values from being presented as GSU research data.

## OpenStreetMap expansion

After the GSU import, `npm run db:import:osm` requests Atlanta features tagged
`amenity=toilets` from Overpass. It preserves all tags, maps only explicit OSM values, and leaves
OSM-only locations historically unverified. A nearby GSU match remains the primary record while
its OSM provenance is added under `source_metadata.additional_sources`.

## Confidence and ranking

`calculateAccessConfidence(restroom, reports)` is deterministic and server-side. It considers:

- the latest positive or negative report
- time decay at 30 minutes, 3 hours, 24 hours, 7 days, and 30 days
- corroborating reports
- historic GSU accessibility
- explicitly known public and purchase requirements
- source verification age
- an explicit `24/7` hours signal

A successful report within three hours is `confirmed`. A newer negative report within six
hours is `unavailable`. Static source data can produce `likely` or `uncertain`, but never
`confirmed`.

Nearby ranking applies a strong status adjustment and a bounded distance penalty so a slightly
farther high-confidence restroom can rank above an unreliable closer option.

## API

| Endpoint                          | Purpose                                          |
| --------------------------------- | ------------------------------------------------ |
| `GET /api/restrooms?lat=&lng=`    | Ranked nearby restrooms and confidence           |
| `POST /api/restrooms/:id/reports` | Append one anonymous timestamped event           |
| `GET /api/geocode?q=`             | Atlanta-bounded address lookup through Nominatim |

Allowed report statuses are `accessible`, `locked`, `closed`, `customer_only`,
`out_of_service`, `not_found`, and `other`.

## Validation

```sh
npm test
npm run check
npm run lint
npm run build
```

## DigitalOcean

The repository includes a multi-stage, non-root Docker image. In DigitalOcean App Platform:

1. Create an app from this repository and select the Dockerfile.
2. Add `DATABASE_URL` as an encrypted runtime environment variable.
3. Keep `DATABASE_SSL_REJECT_UNAUTHORIZED=true`.
4. Expose HTTP port `8080`.
5. Run the schema/import/seed commands once from a trusted job or console before the demo.

The container starts with `node build` and binds to `0.0.0.0:8080`.

## Data transparency

- PLOS Water paper:
  <https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574>
- Public OSF project: <https://osf.io/fm9by>
- Map tiles: © OpenStreetMap contributors

Relief ATL always shows record provenance separately from community confirmation. An entry in a
dataset means a restroom may exist; a physical audit is historical evidence; only a recent
successful report means recently confirmed.
