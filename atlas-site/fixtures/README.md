Purpose: Regression scaffold for ledger immutability and supersede behavior.

What it tests:
- recordId determinism
- canonicalUrl normalization consistency
- immutability (no overwrites)
- supersede sidecar creation next to old ledger

How to run:
- npm run clean:fixtures
- npm run test:ledger -- --slot morning --date 2025-12-26 --oldRecordId ipo_2602f178327d --dateOld 2025-12-26 --dateNew 2025-12-27

Repository hygiene:
- fixture outputs are gitignored by design

Expected result: ok:true
