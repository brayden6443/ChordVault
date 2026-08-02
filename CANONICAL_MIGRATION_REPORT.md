# Canonical voicing migration report

## Run summary

- Mode: applied to the current file-backed public vault; reusable dry-run/upsert API added
- Canonical library size: 149
- Canonical shapes added: 147
- Existing shapes upgraded: 2 (`Em9` and `Bm11`)
- Exact duplicate public cards retained: 0
- Existing curated records preserved as Other Approved: 6
- Validation failures: 0
- Records requiring manual review: 0

## Canonical coverage

- Essential Open: 29 validated shapes
- Essential Barre: 120 validated shapes
- Barre coverage: E-shape and A-shape major, minor, dominant 7, major 7, and minor 7 across all 12 roots
- Open coverage: foundational major, minor, sus2, sus4, dominant 7, major 7, minor 7, plus established Em9 and Bm11 shapes

## Intentionally not seeded

- Open shapes for roots without a broadly accepted open-position fingering
- Suspended barre families pending a curated source list
- Major 9 open shapes pending a curated source list
- Add9, Min9 beyond Em9, and Min11 beyond Bm11 pending a curated source list
- Alternate enharmonic display duplicates such as both C# and Db

## Safety

`seedCanonicalVoicings(existing, true)` performs a non-mutating dry run. Passing `false` returns a new migrated collection, upgrades exact existing matches with canonical metadata, preserves user fields, and remains idempotent on repeated runs.
