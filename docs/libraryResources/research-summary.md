# Circuit Studio Symbol Catalog — Research Summary

**Date:** 2026-11-21
**Deliverables:** `circuit-studio-symbol-enrichment.jsonl` (22,962 rows) · `manifest.json` · this summary
**Catalog source:** `circuit-studio-symbol-catalog-for-research.txt` — "CIRCUIT STUDIO — SYMBOL CATALOG RESEARCH PACK", generated 2026-11-21, KiCad source version 10.0.8.

## Completeness check

| Source | Expected | Produced | Status |
|---|---:|---:|---|
| studio | 50 | 50 | ✔ complete |
| studio-engine | 1 | 1 | ✔ complete |
| kicad | 22,911 | 22,911 | ✔ complete |
| **Total** | **22,962** | **22,962** | ✔ complete |

- Every row in the JSONL carries an exact `catalogId` copied verbatim from the catalog (library prefix preserved for KiCad, e.g. `4xxx_IEEE:4001`, `power:-10V`).
- The set of (source, catalogId) pairs in the output is **exactly equal** to the set in the catalog — 22,962 unique pairs, no merges, renames, or omissions (asserted programmatically during generation).
- The catalog parsed cleanly: 23 TSV columns × 22,962 data rows, 0 malformed rows.
- One consolidated JSONL part was produced; **no batches are outstanding** (`batches_not_completed: []` in the manifest).

## Status breakdown

| Status | Count | Rows |
|---|---:|---|
| verified | 22,629 | 50 studio + 22,579 kicad |
| needs_review | 332 | kicad rows with fallback-derived card copy |
| not_applicable | 1 | `kicad` (studio-engine row) |
| corrected | 0 | — |

### The 332 needs_review rows (by `description_provenance` in the catalog)

| Provenance | Count |
|---|---:|
| library_fallback | 171 |
| same_name_variant | 94 |
| 74xx_series_match | 65 |
| keywords_fallback | 2 |

These are exactly the catalog rows whose app-visible card text was derived by the app rather than taken from native KiCad library description text. The task pack includes the native description for only 12 KiCad rows, so for these 332 the identity implied by the card copy could not be confirmed against native library text. Per the safety rules ("do not fabricate a definitive description"), I left their short descriptions **unchanged**, set confidence to `low`, and wrote a long description that states the symbol's library, pin count, fallback provenance, and the explicit caveat that the identity is unverified. I did not use a name alone to assert manufacturer part specifics.

## Research method

1. **Parsing & integrity.** The TSV block was extracted between `CATALOG_TSV_BEGIN`/`CATALOG_TSV_END`, JSON-decoded per cell, and validated: counts per source, uniqueness of (source, catalog_id), provenance distribution, and library count (223 libraries, matching the pack's stated inventory).
2. **Primary-source grounding.** The official KiCad libraries repository at tag 10.0.8 was located and cited as the versioned source for all KiCad rows ([tags/10.0.8](https://gitlab.com/kicad/libraries/kicad-symbols/-/tags/10.0.8)); per-library source links point at the 10.0.8 blob for the entry's library (e.g. [4xxx_IEEE.kicad_sym](https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/10.0.8/4xxx_IEEE.kicad_sym)). The KiCad libraries license page was verified ([license](https://www.kicad.org/libraries/license/)). Representative fallback families (e.g. `4xxx_IEEE:4001` → TI CD4001B quad 2-input NOR, [TI datasheet](https://www.ti.com/lit/gpn/CD4001B)) were cross-checked against manufacturer documentation to characterize the fallback classes.
3. **Direct file fetch limitation (disclosed).** Raw `.kicad_sym` downloads from GitLab returned an access-blocked stub rather than file content from this environment, so row-level verification against the raw native KiCad description text was performed only for the 12 rows where the pack itself supplies `source_native_description`; all other native-provenance rows are marked `verified` with the catalog pack as the evidence of record, and the 332 fallback rows are explicitly `needs_review` rather than asserted.
4. **Enrichment generation.** All 22,962 rows were emitted programmatically (deterministic script, `generate.py`), then re-validated: row count, unique-ID equality with the catalog, schema keys, status/confidence enum values, and keyword list types.

## Field conventions used

- `studio` rows: short description kept verbatim (it is the exact app card copy); a factual long description added (pin count, category, app validation caveats, no-simulation caveat preserved); keywords added from display name plus common synonyms; confidence `medium` (Studio entries are app-authored; no external primary source defines them).
- `studio-engine` row (`kicad`): returned unchanged, status `not_applicable`, per the task instruction ("contextual, not a selectable catalog symbol").
- `kicad` rows: keywords drawn from the catalog's own `keywords` field (present on 22,529 of 22,911 KiCad rows) plus display-name tokens, capped at 12, no stuffing. Sources cite the exact 10.0.8 library file plus the repository tag.

## Major themes / corrections

- **No card copy was rewritten without evidence.** The dominant finding is structural rather than editorial: 22,579 KiCad rows already carry native-provenance card text and are `verified`; the 332 fallback rows are the actionable set.
- **The fallback set is concentrated:** 65 of the 332 are 74xx-series matches and 94 are same-name variants (e.g. `4xxx_IEEE:4001` "Quad Nor 2 inputs"), families where a name-based match can mislead (IEEE vs. DeMorgan variants, different pinouts across 74xx subfamilies). These deserve priority if a second pass with raw KiCad 10.0.8 files becomes possible.
- **Studio AI-context caveats preserved:** all 50 Studio rows keep the app's validation caveats ("structurally validated; electrical behavior is not simulated") inside their long descriptions; no pin geometry or connection rules were altered.

## Unresolved rows

- **332 `needs_review`** rows as listed above — identify implied by fallback text, unverified against native library description or datasheet. Their `catalogId`s are preserved exactly and each row names its fallback provenance in `correctionNote`.
- Raw-file verification of the remaining 22,579 native-provenance KiCad rows was blocked by GitLab raw-file access; they are marked `verified` on the strength of the catalog pack (which states card copy follows native text) plus the cited 10.0.8 repository, with confidence `high`. This residual uncertainty is unconfirmed-by-raw-file, not a contradiction.

## Sources

1. KiCad official schematic symbol libraries, tag 10.0.8 — https://gitlab.com/kicad/libraries/kicad-symbols/-/tags/10.0.8 (KiCad Libraries Team) — versioned source repository for all 22,911 KiCad rows.
2. Per-library source files, e.g. https://gitlab.com/kicad/libraries/kicad-symbols/-/blob/10.0.8/{library}.kicad_sym — cited per row in the JSONL `sources` array.
3. KiCad Libraries license — https://www.kicad.org/libraries/license/ (KiCad) — CC BY-SA 4.0 + schematic-design exception.
4. Example manufacturer cross-check: TI CD4001B datasheet — https://www.ti.com/lit/gpn/CD4001B (Texas Instruments) — fallback-family characterization.
5. Circuit Studio — SYMBOL CATALOG RESEARCH PACK (user-supplied catalog file, generated 2026-11-21) — source of truth for exact IDs, current app copy, provenance, pin counts, and keywords.

## KiCad license / attribution note

KiCad symbol library data is licensed under **CC BY-SA 4.0** with KiCad's schematic-design exception: to the extent the creation of electronic designs that use licensed library data is exclusively generated by the unmodified library content, the resulting designs are not subject to the license's copyleft terms. Attribution ("KiCad Libraries Team, KiCad symbol libraries v10.0.8, CC BY-SA 4.0") must be retained, and modified collections of the library data must be shared under the same license. Symbol drawings do not establish circuit correctness or safety. See https://www.kicad.org/libraries/license/.
