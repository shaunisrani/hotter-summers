import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';
import * as topojson from 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm';
import scrollama from 'https://cdn.jsdelivr.net/npm/scrollama@3.2.0/+esm';

// ======================================================================
// Constants & data
// ======================================================================
const COLORS = { historical: '#8a8a8a', ssp126: '#0072b2', ssp245: '#e69f00', ssp585: '#d55e00' };
const LABELS = { historical: 'Historical', ssp126: 'SSP1-2.6', ssp245: 'SSP2-4.5', ssp585: 'SSP5-8.5' };
const LONG = { ssp126: 'strong climate action (SSP1-2.6)', ssp245: 'middle-of-the-road emissions (SSP2-4.5)', ssp585: 'high emissions (SSP5-8.5)' };
const SCEN = ['ssp126', 'ssp245', 'ssp585'];
const fmt = d3.format(',.0f');
const fmt1 = d3.format('.1f');
const RATIO_MIN_BASE = 25; // cities with ~0 baseline CDD (Seattle) have no meaningful ratio

const data = await d3.json('data/cdd.json');
let us = null;
try { us = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json'); }
catch (e) { console.warn('Basemap failed to load', e); }
const statesGeo = us ? topojson.feature(us, us.objects.states).features : [];

const MODELS = data.models;
const cityByName = new Map(data.cities.map((c) => [c.name, c]));
const cityNames = d3.sort(data.cities.map((c) => c.name));

function yearsOf(s) { return d3.range(s.start, s.start + s.models[MODELS[0]].length); }
function seriesRows(city, exp) {
  const s = city.series[exp];
  return yearsOf(s).map((year, i) => {
    const vals = MODELS.map((m) => s.models[m][i]);
    return { year, mean: d3.mean(vals), min: d3.min(vals), max: d3.max(vals), models: Object.fromEntries(MODELS.map((m, k) => [m, vals[k]])) };
  });
}
function rolling(rows, accessor, n = 10) {
  return rows.slice(n - 1).map((r, i) => ({ year: r.year, v: d3.mean(rows.slice(i, i + n), accessor) }));
}
function fullRows(city, exp) { return [...seriesRows(city, 'historical'), ...seriesRows(city, exp)]; }
function periodMean(city, exp, y0, y1) {
  return d3.mean(seriesRows(city, exp).filter((r) => r.year >= y0 && r.year <= y1), (r) => r.mean);
}
const statsCache = new Map();
function stats(city, exp, y0 = 2070, y1 = 2099) {
  const key = `${city.name}|${exp}|${y0}`;
  if (!statsCache.has(key)) {
    const base = periodMean(city, 'historical', 1985, 2014);
    const end = periodMean(city, exp, y0, y1);
    statsCache.set(key, { base, end, delta: end - base, ratio: base > RATIO_MIN_BASE ? end / base : null });
  }
  return statsCache.get(key);
}

// ======================================================================
// Tooltip
// ======================================================================
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

// ======================================================================
// Chart: bubble map
// ======================================================================
function makeMap(container, { onClick } = {}) {
  const W = 975, H = 610;
  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  svg.append('g').selectAll('path').data(statesGeo).join('path').attr('class', 'state').attr('d', d3.geoPath());
  const gB = svg.append('g'), gL = svg.append('g');
  const title = svg.append('text').attr('x', W - 10).attr('y', 22).attr('text-anchor', 'end').attr('class', 'annot').style('font-size', '15px').style('font-weight', 700);
  const r = d3.scaleSqrt().range([0, 46]);
  // fixed domains so circles are comparable across steps/scenarios
  const maxBase = d3.max(data.cities, (c) => stats(c, 'ssp585').base);
  const maxDelta = d3.max(data.cities, (c) => stats(c, 'ssp585').delta);

  function update({ metric = 'delta', scenario = 'ssp585', active = null, showTitle = false }) {
    const color = metric === 'base' ? COLORS.historical : COLORS[scenario];
    r.domain([0, metric === 'base' ? maxBase : maxDelta]);
    const rows = data.cities.map((c) => {
      const s = stats(c, scenario);
      return { c, s, v: Math.max(0, metric === 'base' ? s.base : s.delta), xy: projection([c.lon, c.lat]) };
    });
    title.text(showTitle ? (metric === 'base' ? 'Cooling-degree-days per year, 1985–2014' : `Added cooling-degree-days per year by 2070–2099 · ${LABELS[scenario]}`) : '');

    gB.selectAll('circle').data(d3.sort(rows, (d) => -d.v), (d) => d.c.name)
      .join('circle')
      .attr('class', (d) => 'bubble' + (d.c.name === active ? ' active' : ''))
      .attr('cx', (d) => d.xy[0]).attr('cy', (d) => d.xy[1])
      .on('mousemove', (event, d) => showTip(event,
        `<b>${d.c.name}</b>1985–2014: ${fmt(d.s.base)} CDD/yr<br>2070–2099 (${LABELS[scenario]}): ${fmt(d.s.end)} CDD/yr<br>Change: +${fmt(d.s.delta)}${d.s.ratio ? ` (×${fmt1(d.s.ratio)})` : ''}`))
      .on('mouseleave', hideTip)
      .on('click', (event, d) => onClick && onClick(d.c.name))
      .transition().duration(700)
      .attr('r', (d) => r(d.v))
      .attr('fill', color);

    const lab = gL.selectAll('g.lab').data(rows, (d) => d.c.name).join((enter) => {
      const g = enter.append('g').attr('class', 'lab');
      g.append('text').attr('class', 'label-name');
      g.append('text').attr('class', 'label-val');
      return g;
    });
    lab.each(function (d) {
      const rad = r(d.v);
      const left = false;
      const below = d.c.name === 'San Diego';
      const x = left ? d.xy[0] - rad - 5 : d.xy[0];
      const y = left ? d.xy[1] - 2 : below ? d.xy[1] + rad + 14 : d.xy[1] - rad - 18;
      const anchor = left ? 'end' : 'middle';
      const g = d3.select(this);
      g.select('.label-name').transition().duration(700).attr('x', x).attr('y', y).attr('text-anchor', anchor);
      g.select('.label-name').text(d.c.name);
      g.select('.label-val').transition().duration(700).attr('x', x).attr('y', y + 13).attr('text-anchor', anchor);
      g.select('.label-val').text(metric === 'base' ? fmt(d.v) : `+${fmt(d.v)}`);
    });
  }
  return { update };
}

// ======================================================================
// Chart: relative-change bars
// ======================================================================
function makeBars(container, { onClick, width = 760 } = {}) {
  const W = width, m = { top: 50, right: 60, bottom: 30, left: 100 };
  const rowsAll = data.cities.filter((c) => stats(c, 'ssp585').ratio);
  const H = m.top + rowsAll.length * 34 + m.bottom;
  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const x = d3.scaleLinear().domain([0, d3.max(rowsAll, (c) => stats(c, 'ssp585').ratio) * 1.08]).range([m.left, W - m.right]);
  const y = d3.scaleBand().range([m.top, H - m.bottom]).padding(0.28);
  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`).call(d3.axisBottom(x).ticks(5).tickFormat((d) => `×${d}`));
  svg.append('line').attr('class', 'today-line').attr('x1', x(1)).attr('x2', x(1)).attr('y1', m.top - 6).attr('y2', H - m.bottom);
  svg.append('text').attr('x', x(1)).attr('y', m.top - 10).attr('text-anchor', 'start').attr('dx', 4).text('×1 = no change');
  const title = svg.append('text').attr('x', 0).attr('y', 14).attr('class', 'annot').style('font-size', '15px').style('font-weight', 700);
  const gBars = svg.append('g'), gNames = svg.append('g'), gVals = svg.append('g'), gAnn = svg.append('g').attr('class', 'annot');

  function update({ scenario = 'ssp585', active = null, annotate = false, showTitle = false }) {
    const rows = d3.sort(rowsAll.map((c) => ({ name: c.name, ...stats(c, scenario) })), (d) => -d.ratio);
    y.domain(rows.map((d) => d.name));
    title.text(showTitle ? `Cooling demand in 2070–2099 as a multiple of 1985–2014 · ${LABELS[scenario]}` : '');
    gBars.selectAll('rect').data(rows, (d) => d.name).join('rect')
      .attr('class', 'bar').attr('x', x(0)).attr('rx', 3).attr('height', y.bandwidth())
      .on('mousemove', (event, d) => showTip(event, `<b>${d.name}</b>${fmt(d.base)} → ${fmt(d.end)} CDD/yr<br>×${d.ratio.toFixed(2)} under ${LABELS[scenario]}`))
      .on('mouseleave', hideTip)
      .on('click', (event, d) => onClick && onClick(d.name))
      .transition().duration(700)
      .attr('y', (d) => y(d.name)).attr('width', (d) => x(d.ratio) - x(0))
      .attr('fill', (d) => (d.name === active ? COLORS[scenario] : d3.color(COLORS[scenario]).copy({ opacity: 0.55 })));
    gNames.selectAll('text').data(rows, (d) => d.name).join('text')
      .attr('class', 'bar-name').attr('text-anchor', 'end').attr('x', m.left - 8)
      .style('font-weight', (d) => (d.name === active ? 700 : 400))
      .text((d) => d.name)
      .transition().duration(700).attr('y', (d) => y(d.name) + y.bandwidth() / 2 + 4);
    gVals.selectAll('text').data(rows, (d) => d.name).join('text')
      .attr('class', 'bar-val').text((d) => `×${fmt1(d.ratio)}`)
      .transition().duration(700).attr('x', (d) => x(d.ratio) + 6).attr('y', (d) => y(d.name) + y.bandwidth() / 2 + 4);

    // annotation: contrast the biggest multiplier with the biggest absolute gainer
    gAnn.selectAll('*').remove();
    if (annotate) {
      const top = rows[0];
      const bottom = rows.at(-1);
      gAnn.append('text').attr('x', x(top.ratio) - 8).attr('y', y(top.name) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end')
        .style('font-weight', 700).style('fill', '#fff').text(`cooling need multiplies ${fmt1(top.ratio)}× →`);
      gAnn.append('text').attr('x', x(bottom.ratio) + 48).attr('y', y(bottom.name) + y.bandwidth() / 2 + 4)
        .text(`← largest absolute gain, smallest multiplier`);
    }
  }
  return { update };
}

// ======================================================================
// Chart: one city, scenarios over time
// ======================================================================
function makeLine(container) {
  const W = 900, H = 450, m = { top: 56, right: 150, bottom: 34, left: 58 };
  const svg = d3.select(container).append('svg').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img');
  const x = d3.scaleLinear().domain([1994, 2100]).range([m.left, W - m.right]);
  const y = d3.scaleLinear().range([H - m.bottom, m.top]);
  svg.append('rect').attr('x', x(1994)).attr('width', x(2014) - x(1994)).attr('y', m.top).attr('height', H - m.top - m.bottom).attr('fill', '#efeee9');
  svg.append('text').attr('x', x(2004)).attr('y', m.top + 16).attr('text-anchor', 'middle').text('historical');
  const gGrid = svg.append('g').attr('class', 'grid').attr('transform', `translate(${m.left},0)`);
  const gX = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`);
  const gY = svg.append('g').attr('class', 'axis').attr('transform', `translate(${m.left},0)`);
  svg.append('text').attr('x', m.left).attr('y', 40).text('Cooling-degree-days per year (10-yr rolling mean)');
  const title = svg.append('text').attr('x', m.left).attr('y', 16).attr('class', 'annot').style('font-size', '15px').style('font-weight', 700);
  const gBand = svg.append('g'), gModels = svg.append('g'), gLines = svg.append('g'), gEnd = svg.append('g'), gAnn = svg.append('g').attr('class', 'annot');
  const hover = svg.append('g').style('display', 'none');
  hover.append('line').attr('class', 'crosshair').attr('y1', m.top).attr('y2', H - m.bottom);
  const hit = svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', W - m.left - m.right).attr('height', H - m.top - m.bottom).attr('fill', 'transparent');
  const lineGen = d3.line().x((d) => x(d.year)).y((d) => y(d.v)).curve(d3.curveMonotoneX);

  function update({ city: cityName, scenario = 'ssp585', mode = 'all', showModels = false, annotate = false, showTitle = false }) {
    const city = cityByName.get(cityName);
    const hist = rolling(seriesRows(city, 'historical'), (r) => r.mean);
    const shown = mode === 'one' ? [scenario] : SCEN;
    const lines = SCEN.map((e) => ({ exp: e, rows: rolling(fullRows(city, e), (r) => r.mean).filter((d) => d.year >= 2014) }));
    const models = MODELS.map((mod) => ({ mod, rows: rolling(fullRows(city, scenario), (r) => r.models[mod]).filter((d) => d.year >= 1994) }));
    const lo = rolling(fullRows(city, scenario), (r) => r.min), hi = rolling(fullRows(city, scenario), (r) => r.max);
    const band = lo.map((d, i) => ({ year: d.year, lo: d.v, hi: hi[i].v })).filter((d) => d.year >= 1994);

    const vals = [...hist.map((d) => d.v), ...lines.flatMap((l) => l.rows.map((d) => d.v)), ...(showModels ? band.map((d) => d.hi) : [])];
    y.domain([0, d3.max(vals) * 1.1]).nice();
    gGrid.transition().duration(600).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.left - m.right)).tickFormat(''));
    gX.call(d3.axisBottom(x).tickFormat(d3.format('d')).ticks(8));
    gY.transition().duration(600).call(d3.axisLeft(y).ticks(5).tickFormat(fmt));
    title.text(showTitle ? `${city.name}: cooling demand under three futures` : '');

    gBand.selectAll('path').data(showModels ? [band] : []).join('path').attr('class', 'band').attr('fill', COLORS[scenario])
      .attr('d', d3.area().x((d) => x(d.year)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(d3.curveMonotoneX));
    gModels.selectAll('path').data(showModels ? models : [], (d) => d.mod).join('path').attr('class', 'model-line').attr('stroke', COLORS[scenario])
      .attr('d', (d) => lineGen(d.rows));

    const drawn = [{ exp: 'historical', rows: hist.filter((d) => d.year >= 1994) }, ...lines];
    gLines.selectAll('path').data(drawn, (d) => d.exp).join('path').attr('class', 'line')
      .attr('stroke', (d) => COLORS[d.exp])
      .transition().duration(700)
      .attr('stroke-width', (d) => (d.exp === 'historical' || d.exp === scenario ? 3.2 : 2))
      .attr('opacity', (d) => (d.exp === 'historical' ? 1 : shown.includes(d.exp) ? (d.exp === scenario || mode === 'all' ? 1 : 0.5) : 0))
      .attr('d', (d) => lineGen(d.rows));

    // end labels (collision-nudged)
    const ends = lines.filter((l) => shown.includes(l.exp)).map((l) => ({ exp: l.exp, v: l.rows.at(-1).v, y: y(l.rows.at(-1).v) }));
    d3.sort(ends, (d) => d.y).forEach((d, i, arr) => { if (i && d.y - arr[i - 1].y < 16) d.y = arr[i - 1].y + 16; });
    gEnd.selectAll('text').data(ends, (d) => d.exp).join('text')
      .style('fill', (d) => COLORS[d.exp]).style('font-weight', (d) => (d.exp === scenario ? 700 : 500)).attr('x', W - m.right + 8)
      .text((d) => `${LABELS[d.exp]}: ${fmt(d.v)}`)
      .transition().duration(700).attr('y', (d) => d.y + 4);

    // annotations
    gAnn.selectAll('*').remove();
    const today = hist.at(-1);
    gAnn.append('circle').attr('cx', x(today.year)).attr('cy', y(today.v)).attr('r', 4.5).attr('fill', COLORS.historical).attr('stroke', '#fff');
    gAnn.append('text').attr('x', x(today.year) + 8).attr('y', y(today.v) + 18).text(`today ≈ ${fmt(today.v)}`);
    if (annotate && mode === 'all') {
      const a = lines.find((l) => l.exp === 'ssp126').rows.at(-1), b = lines.find((l) => l.exp === 'ssp585').rows.at(-1);
      const xx = x(2100) + 2;
      gAnn.append('path').attr('d', `M${xx},${y(a.v)} h6 V${y(b.v)} h-6`);
      gAnn.append('text').attr('x', xx - 8).attr('y', (y(a.v) + y(b.v)) / 2 + 4).attr('text-anchor', 'end').style('font-weight', 700)
        .text(`gap by 2100: ${fmt(b.v - a.v)} CDD`);
    }
    if (annotate && showModels) {
      const mid = band.find((d) => d.year === 2080);
      if (mid) gAnn.append('text').attr('x', x(2080)).attr('y', y(mid.hi) - 10).attr('text-anchor', 'middle').text('shaded = range across 3 models');
    }

    // hover
    const dots = hover.selectAll('circle').data(lines.filter((l) => shown.includes(l.exp)), (d) => d.exp).join('circle').attr('class', 'hover-dot').attr('r', 4.5).attr('fill', (d) => COLORS[d.exp]);
    hit.on('mousemove', (event) => {
      const [mx] = d3.pointer(event);
      const yr = Math.max(2015, Math.min(2100, Math.round(x.invert(mx))));
      hover.style('display', null);
      hover.select('.crosshair').attr('x1', x(yr)).attr('x2', x(yr));
      const pts = lines.filter((l) => shown.includes(l.exp)).map((l) => ({ exp: l.exp, v: l.rows.find((d) => d.year === yr)?.v }));
      dots.attr('cx', x(yr)).attr('cy', (d) => y(pts.find((p) => p.exp === d.exp).v));
      showTip(event, `<b>${city.name}, ${yr}</b>` + pts.map((p) => `<span style="color:${COLORS[p.exp]}">●</span> ${LABELS[p.exp]}: ${fmt(p.v)} CDD`).join('<br>'));
    }).on('mouseleave', () => { hover.style('display', 'none'); hideTip(); });
  }
  return { update };
}

// ======================================================================
// Shared state & hero
// ======================================================================
const state = { city: 'Minneapolis' };
function fillCitySelect(sel, value) {
  d3.select(sel).selectAll('option').data(cityNames).join('option').attr('value', (d) => d).text((d) => d);
  d3.select(sel).property('value', value);
}
['#heroCity', '#billCity', '#exCity'].forEach((s) => fillCitySelect(s, state.city));
function setCity(name, source) {
  state.city = name;
  ['#heroCity', '#billCity', '#exCity'].forEach((s) => d3.select(s).property('value', name));
  updateHero(); updateStoryText(); renderStep(currentStep); updateBill(); updateExplore();
}
d3.select('#heroCity').on('change', (e) => setCity(e.target.value));
d3.select('#billCity').on('change', (e) => setCity(e.target.value));
d3.select('#exCity').on('change', (e) => setCity(e.target.value));

function updateHero() {
  const c = cityByName.get(state.city);
  const s = stats(c, 'ssp585', 2055, 2069); // around retirement for today's ~20-year-olds (~2066)
  const days = s.delta / 15; // a typical summer day is ~15 °F above 65 °F → ~15 CDD
  d3.select('#heroAnswer').html(
    `Around 2066, under high emissions, <b>${c.name}</b> would need about <b>${fmt(Math.max(0, s.delta))} more cooling-degree-days</b> a year than in 1985–2014` +
    (s.ratio ? `, <b>${fmt1(s.ratio)}×</b> as much air conditioning` : '') +
    (days >= 1 ? `. That is like adding roughly <b>${fmt(days)} extra hot summer days</b>.` : '.'));
}

// ======================================================================
// Scrollytelling
// ======================================================================
const story = {
  map: makeMap('#v-map'),
  bars: makeBars('#v-bars'),
  line: makeLine('#v-line'),
};
const STEP_VIEW = { base: 'map', delta: 'map', ratio: 'bars', city: 'line', scenarios: 'line', models: 'line' };
let currentStep = 'base';

function ranked(fn) { return d3.sort(data.cities, (c) => -fn(c)); }
function updateStoryText() {
  const byBase = ranked((c) => stats(c, 'ssp585').base);
  const byDelta = ranked((c) => stats(c, 'ssp585').delta);
  const byRatio = ranked((c) => stats(c, 'ssp585').ratio || 0);
  const st = (n) => stats(cityByName.get(n), 'ssp585');
  d3.select('#s-base').html(`In 1985–2014, <b>${byBase[0].name}</b> averaged about ${fmt(st(byBase[0].name).base)} cooling-degree-days a year and <b>${byBase[1].name}</b> ${fmt(st(byBase[1].name).base)}. <b>${byBase.at(-2).name}</b> needed only ${fmt(st(byBase.at(-2).name).base)}. Circle size shows today’s cooling demand.`);
  d3.select('#s-delta').html(`Under high emissions, every city needs more cooling by 2070–2099. The biggest absolute increases land where it is already hot: <b>${byDelta[0].name}</b> adds ${fmt(st(byDelta[0].name).delta)} CDD a year, <b>${byDelta[1].name}</b> ${fmt(st(byDelta[1].name).delta)}, and <b>${byDelta[2].name}</b> ${fmt(st(byDelta[2].name).delta)}.`);
  d3.select('#s-ratio').html(`Measured against what each city is used to, the picture flips. <b>${byRatio[0].name}</b>’s cooling demand multiplies <b>${fmt1(st(byRatio[0].name).ratio)}×</b> and <b>${byRatio[1].name}</b>’s ${fmt1(st(byRatio[1].name).ratio)}×, while <b>${byDelta[0].name}</b>’s grows only ${fmt1(st(byDelta[0].name).ratio)}×. Northern homes, schools and transit were mostly built without air conditioning.`);
  const c = cityByName.get(state.city), s5 = stats(c, 'ssp585'), s1 = stats(c, 'ssp126');
  d3.select('#s-city-h').text(`${c.name}: from ${fmt(s5.base)} to ${fmt(s5.end)}`);
  d3.select('#s-city').html(`Following ${c.name} through the high-emissions future, cooling demand climbs from about <b>${fmt(s5.base)}</b> cooling-degree-days a year to <b>${fmt(s5.end)}</b> by 2070–2099. Change the city at the top of the page to follow a different one.`);
  d3.select('#s-scen').html(`Under strong climate action (SSP1-2.6), ${c.name} levels off near <b>${fmt(s1.end)}</b> CDD. Under high emissions it keeps climbing to <b>${fmt(s5.end)}</b>. The space between the blue and red lines is the part of future cooling bills that is still up to us.`);
  const lo = MODELS.map((m) => d3.mean(c.series.ssp585.models[m].slice(-30)));
  d3.select('#s-models').html(`Three independent climate models give ${c.name} end-century values from <b>${fmt(d3.min(lo))}</b> to <b>${fmt(d3.max(lo))}</b> CDD under high emissions. That spread is real uncertainty, but every model rises. The direction is not in doubt.`);
}

function renderStep(step) {
  currentStep = step;
  const view = STEP_VIEW[step];
  d3.selectAll('.view').classed('on', false);
  d3.select(`#v-${view}`).classed('on', true);
  const cap = d3.select('#viewCaption');
  if (step === 'base') { story.map.update({ metric: 'base', active: state.city, showTitle: true }); cap.text('Circle area = cooling-degree-days per year (3-model mean, historical run). Hover for values.'); }
  if (step === 'delta') { story.map.update({ metric: 'delta', scenario: 'ssp585', active: state.city, showTitle: true }); cap.text('Circle area = added cooling-degree-days per year, 2070–2099 vs 1985–2014, high emissions.'); }
  if (step === 'ratio') { story.bars.update({ scenario: 'ssp585', active: state.city, annotate: true, showTitle: true }); cap.text('Seattle is excluded: its baseline is near zero in the model grid cell, so a ratio is not meaningful.'); }
  if (step === 'city') { story.line.update({ city: state.city, scenario: 'ssp585', mode: 'one', showTitle: true }); cap.text('10-year rolling mean of three climate models. Hover the chart to read any year.'); }
  if (step === 'scenarios') { story.line.update({ city: state.city, scenario: 'ssp585', mode: 'all', annotate: true, showTitle: true }); cap.text('Blue: strong climate action · Orange: middle of the road · Red: high emissions.'); }
  if (step === 'models') { story.line.update({ city: state.city, scenario: 'ssp585', mode: 'all', showModels: true, annotate: true, showTitle: true }); cap.text('Thin lines: GFDL-ESM4, MPI-ESM1-2-LR, MRI-ESM2-0 under high emissions. Shading: their range.'); }
}

const scroller = scrollama();
scroller.setup({ step: '#scrolly .step', offset: 0.55 })
  .onStepEnter(({ element }) => {
    d3.selectAll('#scrolly .step').classed('is-active', false);
    d3.select(element).classed('is-active', true);
    renderStep(element.dataset.step);
  });
addEventListener('resize', () => scroller.resize());

// ======================================================================
// Season heatmap with scrubber (Phoenix, GFDL-ESM4)
// ======================================================================
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DECADES = d3.range(1990, 2100, 10);
const SEASON_THRESHOLD = 100; // CDD in a month ≈ needs AC most days
function phxMonthly(exp) {
  const out = new Map();
  for (const e of ['historical', exp]) {
    const { start, values } = data.phoenixMonthly[e];
    values.forEach((v, i) => out.set(`${start + Math.floor(i / 12)}-${i % 12}`, v));
  }
  return out;
}
function decadeGrid(exp) {
  const mm = phxMonthly(exp);
  return DECADES.map((d0) => MONTHS.map((_, mi) => d3.mean(d3.range(d0, d0 + 10), (y) => mm.get(`${y}-${mi}`))));
}
const heat = (() => {
  const W = 900, m = { top: 26, right: 20, bottom: 10, left: 62 }, cell = 34;
  const H = m.top + DECADES.length * cell + m.bottom;
  const svg = d3.select('#heat').append('svg').attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scaleBand().domain(MONTHS).range([m.left, W - m.right]).padding(0);
  const y = d3.scaleBand().domain(DECADES).range([m.top, H - m.bottom]).padding(0);
  const maxV = d3.max(decadeGrid('ssp585').flat());
  const color = d3.scaleSequential([0, maxV], d3.interpolateOranges);
  svg.append('g').selectAll('text').data(MONTHS).join('text').attr('x', (d) => x(d) + x.bandwidth() / 2).attr('y', m.top - 8).attr('text-anchor', 'middle').text((d) => d);
  svg.append('g').selectAll('text').data(DECADES).join('text').attr('x', m.left - 8).attr('y', (d) => y(d) + y.bandwidth() / 2 + 4).attr('text-anchor', 'end').text((d) => `${d}s`);
  const gCells = svg.append('g');
  const hl = svg.append('rect').attr('class', 'heat-row-hl').attr('x', m.left - 2).attr('width', W - m.left - m.right + 4).attr('height', y.bandwidth());
  const gAnn = svg.append('g').attr('class', 'annot');
  function update(exp, idx) {
    const grid = decadeGrid(exp);
    const cells = grid.flatMap((row, i) => row.map((v, j) => ({ d: DECADES[i], mo: MONTHS[j], v, i })));
    gCells.selectAll('rect').data(cells, (c) => `${c.d}-${c.mo}`).join('rect').attr('class', 'heat-cell')
      .attr('x', (c) => x(c.mo)).attr('y', (c) => y(c.d)).attr('width', x.bandwidth()).attr('height', y.bandwidth())
      .on('mousemove', (event, c) => showTip(event, `<b>Phoenix, ${c.mo}, ${c.d}s</b>${fmt(c.v)} CDD per month (${LABELS[exp]})`))
      .on('mouseleave', hideTip)
      .transition().duration(500)
      .attr('fill', (c) => color(c.v))
      .attr('opacity', (c) => (c.i <= idx ? 1 : 0.18));
    hl.transition().duration(300).attr('y', y(DECADES[idx]));
    // annotate the season edges for the highlighted decade
    gAnn.selectAll('*').remove();
    const st = seasonStats(grid[idx]);
    const { first, last } = st;
    if (first >= 0) {
      gAnn.append('path').attr('d', `M${x(MONTHS[first])},${y(DECADES[idx]) + y.bandwidth() + 4} h${x(MONTHS[last]) + x.bandwidth() - x(MONTHS[first])}`).style('stroke-width', 2.5).style('stroke', '#1f1f1f');
    }
    return st;
  }
  return { update };
})();
function seasonStats(row) {
  const inSeason = row.map((v) => v >= SEASON_THRESHOLD);
  return { months: inSeason.filter(Boolean).length, first: inSeason.indexOf(true), last: inSeason.lastIndexOf(true), peak: d3.max(row) };
}

let playing = null;
function seasonUpdate() {
  const exp = d3.select('#seasonScenario').property('value');
  const idx = +d3.select('#decade').property('value');
  const base = seasonStats(decadeGrid(exp)[0]);
  const now = heat.update(exp, idx);
  d3.select('#decadeLabel').text(`${DECADES[idx]}s`);
  d3.select('#seasonReadout').html(
    `In the <b>${DECADES[idx]}s</b>, Phoenix has <b>${now.months} months</b> with at least ${SEASON_THRESHOLD} cooling-degree-days` +
    (now.first >= 0 ? ` (${MONTHS[now.first]}–${MONTHS[now.last]})` : '') +
    (idx > 0 ? `, compared with ${base.months} in the 1990s.` : '. Press play to see how this changes.'));
}
d3.select('#seasonScenario').on('change', seasonUpdate);
d3.select('#decade').on('input', () => { stop(); seasonUpdate(); });
function stop() { if (playing) { clearInterval(playing); playing = null; d3.select('#play').text('▶ Play'); } }
d3.select('#play').on('click', () => {
  if (playing) return stop();
  const s = d3.select('#decade');
  if (+s.property('value') >= DECADES.length - 1) s.property('value', 0);
  d3.select('#play').text('❚❚ Pause');
  seasonUpdate();
  playing = setInterval(() => {
    const v = +s.property('value') + 1;
    if (v > DECADES.length - 1) return stop();
    s.property('value', v); seasonUpdate();
  }, 900);
});
// autoplay once when the section scrolls into view
new IntersectionObserver((entries, obs) => {
  if (entries[0].isIntersecting) { obs.disconnect(); if (+d3.select('#decade').property('value') === 0) d3.select('#play').dispatch('click'); }
}, { threshold: 0.5 }).observe(document.getElementById('heat'));
seasonUpdate();

// ======================================================================
// Personal bill estimate
// ======================================================================
const billChart = (() => {
  const W = 760, H = 230, m = { top: 20, right: 120, bottom: 30, left: 150 };
  const svg = d3.select('#billChart').append('svg').attr('viewBox', `0 0 ${W} ${H}`);
  const x = d3.scaleLinear().range([m.left, W - m.right]);
  const yb = d3.scaleBand().domain(['Today (1985–2014)', '2040–2069', '2070–2099']).range([m.top, H - m.bottom]).padding(0.3);
  const gX = svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${H - m.bottom})`);
  const gBars = svg.append('g'), gTxt = svg.append('g');
  svg.append('g').selectAll('text').data(yb.domain()).join('text').attr('class', 'bar-name').attr('text-anchor', 'end').attr('x', m.left - 8).attr('y', (d) => yb(d) + yb.bandwidth() / 2 + 4).text((d) => d);
  function update(rows, exp) {
    x.domain([0, d3.max(rows, (d) => d.v) * 1.1 || 1]);
    gX.call(d3.axisBottom(x).ticks(5).tickFormat((d) => `$${d}`));
    gBars.selectAll('rect').data(rows, (d) => d.k).join('rect').attr('x', x(0)).attr('y', (d) => yb(d.k)).attr('height', yb.bandwidth()).attr('rx', 3)
      .attr('fill', (d, i) => (i === 0 ? COLORS.historical : COLORS[exp]))
      .transition().duration(500).attr('width', (d) => x(d.v) - x(0));
    gTxt.selectAll('text').data(rows, (d) => d.k).join('text').attr('class', 'bar-val').attr('y', (d) => yb(d.k) + yb.bandwidth() / 2 + 4)
      .text((d) => `$${fmt(d.v)}/mo`).transition().duration(500).attr('x', (d) => x(d.v) + 6);
  }
  return { update };
})();
function updateBill() {
  const c = cityByName.get(state.city);
  const exp = d3.select('#billScenario').property('value');
  const now = Math.max(0, +d3.select('#billInput').property('value') || 0);
  const mid = stats(c, exp, 2040, 2069), end = stats(c, exp, 2070, 2099);
  if (!end.ratio) {
    billChart.update([{ k: 'Today (1985–2014)', v: now }, { k: '2040–2069', v: now }, { k: '2070–2099', v: now }], exp);
    d3.select('#billReadout').html(`${c.name}’s climate-model grid cell shows almost no cooling demand today, so we can’t scale a bill from it. Try another city.`);
    return;
  }
  const rows = [{ k: 'Today (1985–2014)', v: now }, { k: '2040–2069', v: now * mid.ratio }, { k: '2070–2099', v: now * end.ratio }];
  billChart.update(rows, exp);
  d3.select('#billReadout').html(`In <b>${c.name}</b> under ${LONG[exp]}, a $${fmt(now)} summer cooling bill would become about <b>$${fmt(now * mid.ratio)}</b> by mid-century and <b>$${fmt(now * end.ratio)}</b> by late century, from the weather alone.`);
}
d3.select('#billScenario').on('change', updateBill);
d3.select('#billInput').on('input', updateBill);

// ======================================================================
// Free explore (linked views)
// ======================================================================
const ex = {
  map: makeMap('#ex-map', { onClick: (n) => setCity(n) }),
  bars: makeBars('#ex-bars', { onClick: (n) => setCity(n), width: 500 }),
  line: makeLine('#ex-line'),
};
d3.select('#exScenario').on('change', updateExplore);
d3.select('#exModels').on('change', updateExplore);
function updateExplore() {
  const scenario = d3.select('#exScenario').property('value');
  const showModels = d3.select('#exModels').property('checked');
  ex.map.update({ metric: 'delta', scenario, active: state.city });
  ex.bars.update({ scenario, active: state.city });
  ex.line.update({ city: state.city, scenario, mode: 'all', showModels });
  d3.select('#exLineTitle').text(`${state.city}: cooling-degree-days under three futures (highlighted: ${LABELS[scenario]})`);
}

// ======================================================================
// Init
// ======================================================================
updateHero();
updateStoryText();
renderStep('base');
updateBill();
updateExplore();
