import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';

const COLORS = { historical: '#8a8a8a', ssp126: '#0072b2', ssp245: '#e69f00', ssp585: '#d55e00' };
const LABELS = { historical: 'Historical', ssp126: 'SSP1-2.6', ssp245: 'SSP2-4.5', ssp585: 'SSP5-8.5' };
const fmt = d3.format(',.0f');

const state = { scenario: 'ssp585', city: 'Phoenix', showModels: false };

const data = await d3.json('data/cdd.json');
let us = null;
try {
  us = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json');
} catch (e) {
  console.warn('Basemap failed to load; drawing cities only.', e);
}

// ---------- data helpers ----------
const MODELS = data.models;
const cityByName = new Map(data.cities.map((c) => [c.name, c]));

function yearsOf(s) { return d3.range(s.start, s.start + s.models[MODELS[0]].length); }

// rows: {year, mean, min, max, models:{m: v}}
function seriesRows(city, exp) {
  const s = city.series[exp];
  return yearsOf(s).map((year, i) => {
    const vals = MODELS.map((m) => s.models[m][i]);
    return { year, mean: d3.mean(vals), min: d3.min(vals), max: d3.max(vals), models: Object.fromEntries(MODELS.map((m, k) => [m, vals[k]])) };
  });
}

// 10-year centered-left rolling mean
function smooth(rows, key = 'mean', n = 10) {
  return rows.map((r, i) => {
    const w = rows.slice(Math.max(0, i - n + 1), i + 1);
    return { ...r, [key + 'S']: d3.mean(w, (d) => d[key]) };
  }).slice(n - 1);
}

function periodMean(city, exp, y0, y1) {
  return d3.mean(seriesRows(city, exp).filter((r) => r.year >= y0 && r.year <= y1), (r) => r.mean);
}

function cityStats(city, exp) {
  const base = periodMean(city, 'historical', 1985, 2014);
  const end = periodMean(city, exp, 2070, 2099);
  return { base, end, delta: end - base, ratio: base > 25 ? end / base : null };
}

// ---------- tooltip ----------
const tip = d3.select('#tooltip');
function showTip(event, html) {
  tip.html(html).attr('hidden', null);
  const pad = 14, w = tip.node().offsetWidth, h = tip.node().offsetHeight;
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + w > innerWidth - 8) x = event.clientX - w - pad;
  if (y + h > innerHeight - 8) y = event.clientY - h - pad;
  tip.style('left', `${x}px`).style('top', `${y}px`);
}
function hideTip() { tip.attr('hidden', true); }

// ---------- controls ----------
const citySel = d3.select('#city');
citySel.selectAll('option')
  .data(d3.sort(data.cities, (c) => c.name))
  .join('option')
  .attr('value', (c) => c.name)
  .text((c) => c.name);
citySel.property('value', state.city);

d3.select('#scenario').on('change', (e) => { state.scenario = e.target.value; updateAll(); });
citySel.on('change', (e) => { state.city = e.target.value; updateAll(); });
d3.select('#showModels').on('change', (e) => { state.showModels = e.target.checked; updateLine(); });

// ---------- 1. map ----------
const MW = 975, MH = 610;
const mapSvg = d3.select('#map').append('svg').attr('viewBox', `0 0 ${MW} ${MH}`);
// us-atlas albers files are pre-projected to 975x610 with this projection
const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);

if (us) {
  mapSvg.append('g')
    .selectAll('path')
    .data(topojson.feature(us, us.objects.states).features)
    .join('path')
    .attr('class', 'state')
    .attr('d', d3.geoPath());
}
const bubbleG = mapSvg.append('g');
const labelG = mapSvg.append('g');
const rScale = d3.scaleSqrt().range([0, 42]);

function updateMap() {
  const exp = state.scenario;
  const rows = data.cities.map((c) => ({ city: c, ...cityStats(c, exp), xy: projection([c.lon, c.lat]) }));
  const maxDelta = d3.max(data.cities, (c) => cityStats(c, 'ssp585').delta); // fixed domain across scenarios
  rScale.domain([0, maxDelta]);
  const sorted = d3.sort(rows, (r) => -r.delta);

  bubbleG.selectAll('circle')
    .data(sorted, (r) => r.city.name)
    .join('circle')
    .attr('class', (r) => 'bubble' + (r.city.name === state.city ? ' active' : ''))
    .attr('cx', (r) => r.xy[0])
    .attr('cy', (r) => r.xy[1])
    .style('--color', COLORS[exp])
    .attr('r', (r) => rScale(Math.max(0, r.delta)))
    .on('mousemove', (event, r) => showTip(event,
      `<b>${r.city.name}</b>1985–2014: ${fmt(r.base)} CDD/yr<br>2070–2099 (${LABELS[exp]}): ${fmt(r.end)} CDD/yr<br>Change: <b style="display:inline">+${fmt(r.delta)}</b>${r.ratio ? ` (×${r.ratio.toFixed(1)})` : ''}`))
    .on('mouseleave', hideTip)
    .on('click', (event, r) => { state.city = r.city.name; citySel.property('value', state.city); updateAll(); });

  labelG.selectAll('text')
    .data(rows, (r) => r.city.name)
    .join('text')
    .attr('class', 'bubble-label')
    .attr('x', (r) => r.xy[0] + (r.city.name === 'Los Angeles' ? -rScale(Math.max(0, r.delta)) - 4 : 0))
    .attr('y', (r) => (r.city.name === 'Los Angeles' ? r.xy[1] + 4 : r.xy[1] - rScale(Math.max(0, r.delta)) - 5))
    .attr('text-anchor', (r) => (r.city.name === 'Los Angeles' ? 'end' : 'middle'))
    .text((r) => r.city.name);
}

// ---------- 2. line chart ----------
const LW = 900, LH = 380, lm = { top: 16, right: 110, bottom: 32, left: 56 };
const lineSvg = d3.select('#line').append('svg').attr('viewBox', `0 0 ${LW} ${LH}`);
const lx = d3.scaleLinear().domain([1994, 2100]).range([lm.left, LW - lm.right]);
const ly = d3.scaleLinear().range([LH - lm.bottom, lm.top]);
const lineGrid = lineSvg.append('g').attr('class', 'grid').attr('transform', `translate(${lm.left},0)`);
const lineXAxis = lineSvg.append('g').attr('class', 'axis').attr('transform', `translate(0,${LH - lm.bottom})`);
const lineYAxis = lineSvg.append('g').attr('class', 'axis').attr('transform', `translate(${lm.left},0)`);
lineSvg.append('rect').attr('x', lx(1994)).attr('width', lx(2014) - lx(1994)).attr('y', lm.top).attr('height', LH - lm.top - lm.bottom).attr('fill', '#efefec');
lineSvg.append('text').attr('x', lx(2004)).attr('y', lm.top + 14).attr('text-anchor', 'middle').text('historical');
const bandG = lineSvg.append('g');
const modelG = lineSvg.append('g');
const lineG = lineSvg.append('g');
const endLabelG = lineSvg.append('g');
const hoverG = lineSvg.append('g').style('display', 'none');
hoverG.append('line').attr('class', 'crosshair').attr('y1', lm.top).attr('y2', LH - lm.bottom);

const lineGen = d3.line().x((d) => lx(d.year)).y((d) => ly(d.meanS));

function updateLine() {
  const city = cityByName.get(state.city);
  const hist = seriesRows(city, 'historical');
  const exps = ['ssp126', 'ssp245', 'ssp585'];
  // join historical onto each scenario so rolling means are continuous
  const series = exps.map((e) => ({ exp: e, rows: smooth([...hist, ...seriesRows(city, e)]).filter((r) => r.year >= 1994) }));
  const histS = smooth(hist);
  const selected = series.find((s) => s.exp === state.scenario);
  const modelSeries = MODELS.map((m) => ({ m, rows: smooth([...hist, ...seriesRows(city, state.scenario)].map((r) => ({ ...r, v: r.models[m] })), 'v') }));

  const allVals = series.flatMap((s) => s.rows.map((r) => r.meanS)).concat(state.showModels ? modelSeries.flatMap((s) => s.rows.map((r) => r.vS)) : []);
  ly.domain([0, d3.max(allVals) * 1.08]).nice();

  lineGrid.call(d3.axisLeft(ly).ticks(5).tickSize(-(LW - lm.left - lm.right)).tickFormat(''));
  lineXAxis.call(d3.axisBottom(lx).tickFormat(d3.format('d')).ticks(8));
  lineYAxis.call(d3.axisLeft(ly).ticks(5).tickFormat(fmt));

  d3.select('#lineCaption').html(`Annual cooling-degree-days in <b>${city.name}</b>, 10-year rolling mean of three climate models. The highlighted line is your selected scenario. <b>Hover</b> to read values.`);

  // model spread band for selected scenario
  const bandRows = smooth([...hist, ...seriesRows(city, state.scenario)].map((r) => ({ ...r, lo: r.min, hi: r.max })), 'lo')
    .map((r, i, arr) => r);
  const loS = smooth([...hist, ...seriesRows(city, state.scenario)], 'min');
  const hiS = smooth([...hist, ...seriesRows(city, state.scenario)], 'max');
  const band = loS.map((r, i) => ({ year: r.year, lo: r.minS, hi: hiS[i].maxS })).filter((r) => r.year >= 1994);
  bandG.selectAll('path').data(state.showModels ? [band] : [])
    .join('path').attr('class', 'band').attr('fill', COLORS[state.scenario])
    .attr('d', d3.area().x((d) => lx(d.year)).y0((d) => ly(d.lo)).y1((d) => ly(d.hi)));

  modelG.selectAll('path').data(state.showModels ? modelSeries : [], (d) => d.m)
    .join('path').attr('class', 'model-line').attr('stroke', COLORS[state.scenario])
    .attr('d', (d) => d3.line().x((r) => lx(r.year)).y((r) => ly(r.vS))(d.rows.filter((r) => r.year >= 1994)));

  lineG.selectAll('path').data([...series, { exp: 'historical', rows: histS }], (d) => d.exp)
    .join('path').attr('class', 'line')
    .attr('stroke', (d) => COLORS[d.exp])
    .attr('stroke-width', (d) => (d.exp === state.scenario || d.exp === 'historical' ? 3 : 1.6))
    .attr('opacity', (d) => (d.exp === state.scenario || d.exp === 'historical' ? 1 : 0.45))
    .transition().duration(500)
    .attr('d', (d) => lineGen(d.rows));

  // end labels, nudged apart to avoid collisions
  const ends = series.map((s) => ({ exp: s.exp, y: ly(s.rows.at(-1).meanS), v: s.rows.at(-1).meanS }));
  d3.sort(ends, (d) => d.y).forEach((d, i, arr) => { if (i > 0 && d.y - arr[i - 1].y < 15) d.y = arr[i - 1].y + 15; });
  endLabelG.selectAll('text').data(ends, (d) => d.exp)
    .join('text')
    .attr('x', LW - lm.right + 6)
    .attr('y', (d) => d.y + 4)
    .attr('fill', (d) => COLORS[d.exp])
    .style('fill', (d) => COLORS[d.exp])
    .style('font-weight', (d) => (d.exp === state.scenario ? 700 : 400))
    .text((d) => `${LABELS[d.exp]} ${fmt(d.v)}`);

  // hover layer
  const dots = hoverG.selectAll('circle.hover-dot').data(series, (d) => d.exp)
    .join('circle').attr('class', 'hover-dot').attr('r', 4.5).attr('fill', (d) => COLORS[d.exp]);
  lineSvg.selectAll('rect.hit').data([0]).join('rect').attr('class', 'hit')
    .attr('x', lm.left).attr('y', lm.top).attr('width', LW - lm.left - lm.right).attr('height', LH - lm.top - lm.bottom)
    .attr('fill', 'transparent')
    .on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const year = Math.max(2015, Math.min(2100, Math.round(lx.invert(mx))));
      hoverG.style('display', null);
      hoverG.select('.crosshair').attr('x1', lx(year)).attr('x2', lx(year));
      const vals = series.map((s) => ({ exp: s.exp, v: s.rows.find((r) => r.year === year)?.meanS }));
      dots.attr('cx', lx(year)).attr('cy', (d) => ly(vals.find((v) => v.exp === d.exp).v));
      showTip(event, `<b>${city.name}, ${year}</b>` + vals.map((v) => `<span style="color:${COLORS[v.exp]}">●</span> ${LABELS[v.exp]}: ${fmt(v.v)} CDD`).join('<br>'));
    })
    .on('mouseleave', () => { hoverG.style('display', 'none'); hideTip(); });

  d3.select('#lineLegend').html(['historical', ...exps].map((e) => `<span style="--c:${COLORS[e]}">${LABELS[e]}</span>`).join('') + (state.showModels ? '<span style="--c:rgba(0,0,0,.25)">individual models (thin) + spread (shaded)</span>' : ''));
}

// ---------- 3. bars: relative change ----------
const BW = 900, bm = { top: 6, right: 90, bottom: 26, left: 110 };
const barSvg = d3.select('#bars').append('svg');
const bx = d3.scaleLinear().range([bm.left, BW - bm.right]);
const by = d3.scaleBand().padding(0.28);
const barAxis = barSvg.append('g').attr('class', 'axis');
const refLine = barSvg.append('line').attr('stroke', '#999').attr('stroke-dasharray', '3 3');
const refText = barSvg.append('text').attr('text-anchor', 'middle');

function updateBars() {
  const exp = state.scenario;
  const rows = d3.sort(data.cities.map((c) => ({ name: c.name, ...cityStats(c, exp) })).filter((r) => r.ratio), (r) => -r.ratio);
  const BH = bm.top + rows.length * 30 + bm.bottom;
  barSvg.attr('viewBox', `0 0 ${BW} ${BH}`);
  by.domain(rows.map((r) => r.name)).range([bm.top, BH - bm.bottom]);
  const maxRatio = d3.max(data.cities.map((c) => cityStats(c, 'ssp585').ratio).filter(Boolean));
  bx.domain([0, maxRatio * 1.05]);
  barAxis.attr('transform', `translate(0,${BH - bm.bottom})`).call(d3.axisBottom(bx).ticks(6).tickFormat((d) => `×${d}`));
  refLine.attr('x1', bx(1)).attr('x2', bx(1)).attr('y1', bm.top - 4).attr('y2', BH - bm.bottom);
  refText.attr('x', bx(1)).attr('y', BH - bm.bottom + 0).attr('dy', -4).text('');

  barSvg.selectAll('rect.bar').data(rows, (r) => r.name)
    .join('rect').attr('class', 'bar')
    .style('--color', COLORS[exp])
    .attr('x', bx(0)).attr('height', by.bandwidth())
    .attr('rx', 3)
    .on('mousemove', (event, r) => showTip(event, `<b>${r.name}</b>${fmt(r.base)} → ${fmt(r.end)} CDD/yr<br>×${r.ratio.toFixed(2)} under ${LABELS[exp]}`))
    .on('mouseleave', hideTip)
    .on('click', (event, r) => { state.city = r.name; citySel.property('value', state.city); updateAll(); })
    .transition().duration(500)
    .attr('y', (r) => by(r.name))
    .attr('width', (r) => bx(r.ratio) - bx(0));

  barSvg.selectAll('text.name').data(rows, (r) => r.name)
    .join('text').attr('class', 'name bar-label').attr('text-anchor', 'end')
    .attr('x', bm.left - 8)
    .style('font-weight', (r) => (r.name === state.city ? 700 : 400))
    .transition().duration(500)
    .attr('y', (r) => by(r.name) + by.bandwidth() / 2 + 4)
    .text((r) => r.name);

  barSvg.selectAll('text.val').data(rows, (r) => r.name)
    .join('text').attr('class', 'val bar-label')
    .transition().duration(500)
    .attr('x', (r) => bx(r.ratio) + 6)
    .attr('y', (r) => by(r.name) + by.bandwidth() / 2 + 4)
    .text((r) => `×${r.ratio.toFixed(1)}`);
}

function updateAll() { updateMap(); updateLine(); updateBars(); }
updateAll();
