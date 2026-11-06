# Hotter Summers, Bigger Bills

DSC 106 Final Project — an explorable explanation of projected cooling demand across U.S. cities.

**Team:** Shaun Israni, Corey Ngo, Abhinav Krishna, Srinivas Sriram

## Data
CMIP6 near-surface air temperature (`Amon/tas`, member `r1i1p1f1`) from the NOAA/Pangeo public dataset on Google Cloud (`gs://cmip6`), for GFDL-ESM4, MPI-ESM1-2-LR and MRI-ESM2-0: historical (1985–2014) and SSP1-2.6 / SSP2-4.5 / SSP5-8.5 (2015–2100). For each of 11 cities we use the nearest grid cell and compute annual cooling-degree-days (base 65 °F) from monthly means. Output: `data/cdd.json`.

Note: some model stores use time origins that don't match their first timestep (e.g. GFDL scenario runs count from 1850; MPI scenario runs store 2015–2034 at the end of the array), so the time coordinate must be decoded explicitly.

## Page structure
1. **Hook**: pick a city; personalized answer for ~2066
2. **Scrollytelling** (Scrollama): today → and every city rises → but northern cities multiply most → your city → therefore emissions choices matter → model uncertainty
3. **Season heatmap**: Phoenix month × decade with play/scrub animation
4. **Bill estimator**: scale your own summer cooling bill by projected CDD change
5. **Explore**: linked map, bars and line chart
6. **Takeaway**, demo video slot, data & methods

## Files
- `index.html` — page structure and text
- `main.js` — D3 charts, Scrollama story, interactions
- `style.css` — styles
- `data/cdd.json` — processed CMIP6 cooling-degree-days
