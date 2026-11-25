---
paths:
  - "tests/fixtures/**"
  - "lib/Service/GreatCircle.php"
  - "lib/Service/AircraftTypeImportService.php"
---

# Demo dataset (`tests/fixtures/`)

`demo-flights.json` is a ~200-leg JSON export (restorable via Personal settings → Import) produced by `generate_demo_flights.py`. **Both reference datasets are loaded from the real files an admin imports** — airports from the mwgg/Airports JSON, aircraft from the DOC 8643 CSV — so every flight's `*Code`/`*Label`/`distance_km` and its aircraft designator/manufacturer/model are exactly what reconciliation produces: the fixture round-trips, edits don't corrupt it, and a recheck is a no-op. **Never hand-edit the fixture or reintroduce values that disagree with the reference** — a defective fixture self-corrupts on recheck and breaks the map. Regenerate with:

```
python3 tests/fixtures/generate_demo_flights.py \
  --airports /path/to/airports.json --aircraft-types /path/to/icao_aircraft_data.csv
```

Neither reference file is committed; the script errors clearly if either is missing. Two pieces of logic are duplicated from PHP and must be kept in step: the haversine radius matches `Service/GreatCircle.php`, and `_canonical()` (with `_PREFERRED` and `_DERIVATIVE`) matches `AircraftTypeImportService::pickCanonical`.

**Deliberate gaps** exercise the "unmatched" filters and give the editor something real to fix:

- **Airports:** five legs carry a `null` code on the unrecognised side.
- **Aircraft:** `NEAR_MISS` holds plausible shorthand the reference does *not* contain, grouped by failure shape — a manufacturer prefix (`B737-800` vs `737-800`), a trailing marketing word (`787-9` vs `787-9 Dreamliner`), a trailing programme name (`A350-900` vs `A-350-900 XWB`). `NEAR_MISS_PER_SHAPE` legs of each are converted in a **deterministic post-pass, not by probability**: only ~26 legs use a near-miss-capable designator at all, so chance regularly dropped an entire shape and a reseed could silently remove one. A further `NO_AIRCRAFT_RATE` of legs record no aircraft at all. Current split: 187 resolved / 8 near-miss / 5 empty.

**The "typed" text is not always the model name.** `load_aircraft_reference` prefers the canonical model as the raw value for realism, but falls back to the designator when that model is ambiguous across manufacturers (E190's canonical model is the bare `190`) or is itself a designator — either would resolve somewhere other than the intended row, leaving a flight whose stored triple contradicts its own text.
