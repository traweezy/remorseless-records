# Storefront fonts

These are unmodified Google Fonts WOFF2 files fetched on October 3, 2026.
All 18 files matched the fonts emitted by the existing Next 16.3.8 build byte
for byte. `sources.json` records the vendor URLs, SHA-256 hashes, family source
revisions and pinned SIL Open Font License 1.1 notices. Each notice is included
here; retain it when redistributing the fonts. No font software was modified.

`src/styles/fonts.css` preserves the vendor CSS weights and Unicode ranges.
Its metric-adjusted Arial fallbacks match the previous Next font loader.
Only each family's Latin file is preloaded; other scripts load on demand.
The filenames contain content hashes and receive immutable cache headers.
Builds and browsers do not need Google Fonts network access.

To update, review vendor provenance and licensing, retain all supported glyph
subsets, update assets and hashes together, and verify font loading, fallback
metrics and rendered layout at desktop and mobile sizes. Run
`node scripts/verify-font-assets.mjs` from the Storefront directory. This checks
local integrity and wiring without fetching or trusting a current remote URL.
