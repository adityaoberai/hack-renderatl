# Relief ATL

**Find a restroom in Atlanta you can actually use.**

A restroom appearing on a map does not mean a person can get inside it. It can be
locked, closed, customers-only, out of service, inaccessible to someone with a
disability, or simply listed wrong.

Relief ATL takes a valuable but static Georgia State University dataset of Atlanta
restroom accessibility and makes it actionable, by layering recent anonymous
community confirmations on top of it.

The product keeps three ideas strictly separate:

|                            | question                                     | evidence            |
| -------------------------- | -------------------------------------------- | ------------------- |
| **Existence**              | a dataset says a restroom is here            | a listing           |
| **Verified accessibility** | somebody physically checked it could be used | the GSU field audit |
| **Current availability**   | somebody confirmed it recently               | community reports   |

---

## The data

### Primary source: GSU / OSF public dataset

> _Public bathrooms as public goods: Assessing availability and accessibility in
> Atlanta, Georgia_: PLOS Water, 24 June 2026
> [Paper](https://journals.plos.org/water/article?id=10.1371/journal.pwat.0000574) ·
> [Data](https://osf.io/fm9by)

Researchers audited **262 potential restroom locations across 15 areas of Atlanta**
between February and April 2025, visiting each in person. Only **117 had an
accessible restroom** when they arrived. The published spreadsheet
(`static/fm9by-osfstorage-archive/Full dataset.xlsx`) contains **207 individual
restroom audits at those 117 locations**.

`scripts/import-gsu.mjs` groups the audits by GPS coordinate into one record per
physical location and maps the original columns into the app schema. Variable
meanings were verified against the published paper: for example `Permiss`
(staff permission required) yields 91 of 117 locations needing none, reproducing
Table 1 of the paper exactly. Every record keeps `source: "gsu"`, its audit date,
and the complete original rows inside `source_metadata`.

The published file has no facility names, so the importer reverse-geocodes each
coordinate (Nominatim, then an Overpass second pass matched on facility type).
111 of 117 locations resolve to a real building name; the remaining six fall back
to an honest `"<facility type> · <study area>"` label rather than a guess.

### Secondary source: OpenStreetMap

`scripts/fetch-osm.mjs` pulls `amenity=toilets` across metro Atlanta via Overpass
(**81 OSM-only locations** after deduplication). These extend coverage beyond the
15 studied areas but carry a weaker claim: nobody physically verified them, so
`historically_accessible` stays `NULL` and they render grey until a real community
report arrives. Where an OSM entry overlaps an audited location the GSU record
wins and the OSM id is preserved as a cross-reference.

Missing attributes are always `NULL` and are omitted from the UI. They are never
rendered as "no".

---

## Why Tiger Data

Restroom availability is a time-series problem:

```
10:05 AM → accessible
12:31 PM → accessible
 2:47 PM → locked
 3:12 PM → locked
 4:03 PM → accessible
```

Every anonymous confirmation is stored as **an immutable, timestamped event** in a
Tiger Data hypertable. Nothing is ever overwritten: there is no
`current_status` column. The current picture is always _derived_ from recent
events, which is what makes "recent reality overrides stale assumptions" possible.

- `restrooms`: slow-moving facts from public datasets
- `reports`: the hypertable, partitioned on `created_at`, append-only
- `reports_hourly`: a continuous aggregate powering the 24-hour timeline and the
  reliability metric

See [`src/lib/server/schema.sql`](src/lib/server/schema.sql).

---

## Access Confidence Score

`calculateAccessConfidence(restroom, reports)` returns a 0-100 score answering one
question: _how confident are we that someone can use this restroom right now?_
It is fully deterministic: no LLM, no randomness: and the detail view shows the
exact factor breakdown that produced the number.

Two layers:

1. **Static baseline** from public data: physical audit, officially-public status,
   purchase/permission/gate restrictions, parsed opening hours, and decay for the
   age of the source. Capped at 68, so a dataset alone can never earn a green pin.
2. **Evidence layer** from timestamped reports. Its weight saturates fast, so one
   confirmation from 18 minutes ago outweighs an audit from last year. Negative
   reports decay more slowly in the short term and count 1.35× in the balance.

A **freshness ceiling** then caps the score by the age of the most recent success
(99 within 30 min → 93 within 3 h → 78 within 12 h → 52 for historical evidence
only), so a month of accumulated "it was fine" can never masquerade as recency.

Statuses map directly onto the map colours:

| status        | colour | means                                                |
| ------------- | ------ | ---------------------------------------------------- |
| `confirmed`   | 🟢     | someone reported using it within the last few hours  |
| `likely`      | 🟡     | audited as usable, not confirmed lately              |
| `uncertain`   | ⚪     | listed but never verified, or known to be restricted |
| `unavailable` | 🔴     | recent reports say people could not get in           |

Ranking blends confidence with walking time, so a 5-minute walk at 96% outranks a
2-minute walk at 31%.

**There is no seeded or sample report data anywhere in this project.** Every
report is one a real person submitted in the app. A fresh deployment therefore
starts with zero community evidence: locations show only what the public
datasets can prove (amber for audited-but-unconfirmed, grey for OSM listings),
and green has to be earned by somebody who was actually there.

---

## Running it

```bash
npm install
npm run dev
```

That is enough: the app ships with the imported datasets committed under
`src/lib/server/data/`, and with no `DATABASE_URL` it serves them from an
in-memory store. **The demo works with no
database and no network.**

### With Tiger Data (the real thing)

```bash
cp .env.example .env      # add your Tiger Data connection string
npm run db:bootstrap      # setup + import
npm run db:status         # confirm the hypertable and event counts
npm run dev
```

Or run Tiger Data locally:

```bash
docker compose up -d
echo 'DATABASE_URL=postgres://postgres:relief@127.0.0.1:5433/tsdb?sslmode=disable' > .env
npm run db:bootstrap
npm run dev
```

`db:status` should report `Tiger Data hypertable on "reports": yes`, and the
About page's System section flips from _Local demo store_ to _Tiger Data_.

| script              | does                                                                |
| ------------------- | ------------------------------------------------------------------- |
| `npm run db:setup`  | tables, `reports` hypertable, `reports_hourly` continuous aggregate |
| `npm run db:import` | upsert the imported public datasets (idempotent)                    |
| `npm run db:status` | restroom counts by source, event counts, hypertable check           |

The app detects Tiger Data automatically. If a query fails at runtime it logs and
falls back to the bundled public data rather than erroring: a database hiccup
mid-demo degrades instead of breaking.

### Refreshing the source data

```bash
npm run data:all   # re-import OSF xlsx, reverse-geocode, re-fetch OSM
```

Outputs are committed to `src/lib/server/data/`, so the app never touches OSF or
Overpass at runtime.

---

## Deploying to DigitalOcean

Built with `@sveltejs/adapter-node`.

**App Platform**: point it at the repo; it detects Node and runs `npm run build`.
Set the run command to `node build` and add `DATABASE_URL` as an encrypted env var.
The server honours `PORT`.

**Droplet**

```bash
npm ci && npm run build
DATABASE_URL=… PORT=3000 node build
```

---

## No authentication

There is none, by design. No sign-up, no sign-in, no profiles, no sessions, no
OAuth, no tracking. Submitting a report stores the restroom id, the status, and
the timestamp: nothing about the person.

---

## Layout

```
scripts/
  import-gsu.mjs         OSF xlsx → normalised locations (+ reverse geocoding)
  enrich-names.mjs       Overpass second pass for unnamed audit coordinates
  fetch-osm.mjs          amenity=toilets across metro Atlanta
  db.mjs                 setup / import / status / reset
  lib/normalize-gsu.mjs  the GSU column mapping, with the decoded variable meanings

src/lib/
  confidence.ts          Access Confidence Score + reliability (pure, deterministic)
  hours.ts               free-text opening-hours parser ("7 am - 7 pm Monday - Friday")
  geo.ts                 haversine, walking time, ranking blend, directions deep-link
  status.ts              status → colour/label, attribute + provenance formatting
  state.svelte.ts        client application state
  components/            MapView, RestroomCard, DetailSheet, FilterSheet, Timeline
  server/
    schema.sql           Tiger Data schema
    db.ts                connection
    store.ts             storage contract shared by both implementations
    pg-store.ts          Tiger Data
    memory-store.ts      no-database fallback
    restrooms.ts         service layer: nearby search, detail, report submission
    data/                the imported public datasets (committed)

src/routes/
  +page.svelte           landing → map + ranked results + detail sheet
  about/                 data transparency page
  api/restrooms          nearby search
  api/restrooms/[id]     detail + event history + 24h timeline
  api/reports            anonymous report submission
  api/geocode            Nominatim proxy, bounded to Atlanta
```
