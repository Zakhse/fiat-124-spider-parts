# Catalog data

The US English catalog covers model years 2017–2020 and contains 1,254 pages, 31,801 part positions, and 28 PDFs.

- `../2017.js` through `../2020.js` contain catalog pages, part positions, diagram assignments, notes, and fitment rules. `../resources.js` maps diagrams to image files and callout coordinates.
- `../details.js` contains part records, document links, supersessions, historical prices, vehicle codes, and illustration order. `media/` contains linked PDFs and section thumbnails.
- `../vin-data.js` contains 17,414 factory records for North American Fiat 124 Spider vehicles. The data was extracted through `ein_lookup → ein → filter_collection`. The browser hashes the entered VIN to look up a record locally. If there is no factory record, users can specify the market, trim, and transmission manually.
- `provenance.json` records the original archive checksum and validation results. Its counts describe the initial extraction before cleanup.

Run the checks from the repository root.

```sh
node epc-source/check_fitment.cjs
shasum -a 256 -c epc-source/SHA256SUMS
```
