# PA Roads with AADT (PennDOT + RMSS) — Web Map

This is a static site ready for GitHub Pages. It shows Pennsylvania road segments with PennDOT AADT and RMSS rollups.

## Use

1. Put this folder in your GitHub repo (e.g., `pa-aadt-map-site/` at the root).
2. Enable **GitHub Pages** for the repo (Settings → Pages → Source: `main` / root).
3. Open `https://<your-username>.github.io/<repo>/`

### Replacing the sample with the full file
- The site currently loads: `data/PA_Roads_with_AADT_sample.geojson`
- When you have the full GeoJSON (`PA_Roads_with_AADT.geojson`, EPSG:4326), put it in `data/` and either:
  - Replace the sample file by the same name, **or**
  - Edit `index.html` and change `DATA_URL` to your full file.

> Note: GitHub’s size limit is **100 MB per file**. If your statewide GeoJSON exceeds that, consider serving from Git LFS or splitting by county and adding a simple loader. The page here will work with a single file as long as it’s under the limit.

## Fields shown
- From PennDOT: `STREET_NAM`, `CUR_AADT`
- From RMSS (pre-aggregated per segment): `RMSS_CUR_AADT_WAVG`, `RMSS_CUR_AADT_MAX`, `RMSS_ADTT_WAVG`, `RMSS_TRK_PCT_WAVG`, `RMSS_RECORDS`

