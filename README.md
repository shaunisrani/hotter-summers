# Hotter Summers, Bigger Bills

DSC 106 Final Project — an explorable explanation of projected cooling demand across U.S. cities.

**Team:** Shaun Israni, Corey Ngo, Abhinav Krishna, Srinivas Sriram

## Data
CMIP6 near-surface air temperature (`Amon/tas`, member `r1i1p1f1`) from the NOAA/Pangeo public dataset on Google Cloud (`gs://cmip6`), for GFDL-ESM4, MPI-ESM1-2-LR and MRI-ESM2-0: historical (1985–2014) and SSP1-2.6 / SSP2-4.5 / SSP5-8.5 (2015–2100). For each of 11 cities we use the nearest grid cell and compute annual cooling-degree-days (base 65 °F) from monthly means. Output: `data/cdd.json`.

Note: some model stores use time origins that don't match their first timestep (e.g. GFDL scenario runs count from 1850; MPI scenario runs store 2015–2034 at the end of the array), so the time coordinate must be decoded explicitly.

## Files
- `index.html` — page structure and write-up
- `main.js` — D3 charts (map, scenario time series, relative-change bars) and interactions
- `style.css` — styles
- `data/cdd.json` — processed CMIP6 cooling-degree-days
