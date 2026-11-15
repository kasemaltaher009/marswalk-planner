/* Go/no-go poll and the walk's numbers (card over the view), elevation + temperature charts (left panel). */
import {
  state, $, RESERVE_H, COLD_LIMIT_C, DAY_START_H, DAY_END_H,
  startHour, suitHours, selectedWeather, totalHours,
  fmtH, fmtClock, fmtDist, priorityName, pointName,
} from './state.js';
import { airTempAt } from './weather.js';
import { drawElevChart, drawTempChart } from './charts.js';
import { leavePov } from './view3dBridge.js';

/** Each system gives its call: go, caution or nogo. Returns [[level, system, detail], …].
 *  Only caution / no-go details are shown; the numbers behind a "go" are in "The walk" below. */
function poll(route) {
  const { config } = state;
  const s = route.stats;
  const totalH = totalHours(route);
  const t0 = startHour(), t1 = t0 + totalH;
  const suit = suitHours();
  const left = suit - totalH;
  const items = [];

  items.push(left >= RESERVE_H
    ? ['go', 'Suit time', `${fmtH(totalH)} of ${suit} h used, ${fmtH(left)} to spare.`]
    : left >= 0
      ? ['caution', 'Suit time', `Only ${Math.round(left * 60)} min to spare. We want at least ${RESERVE_H * 60} min.`]
      : ['nogo', 'Suit time', `${fmtH(-left)} over the ${suit} h limit. Drop a target or work less at each one.`]);

  const steep = s.maxGradeDeg >= 15, rough = s.roughPct >= 50;
  items.push(!steep && !rough
    ? ['go', 'Terrain', `Steepest section ${s.maxGradeDeg.toFixed(0)}°, ${s.roughPct.toFixed(0)}% on sand or slopes over 10°.`]
    : ['caution', 'Terrain', `${steep ? `A ${s.maxGradeDeg.toFixed(0)}° section: slow down there. ` : ''}${s.roughPct.toFixed(0)}% on sand or slopes over 10°.`]);

  const wx = selectedWeather();
  if (wx) {
    const temps = [];
    for (let h = t0; h <= t1; h += 0.25) temps.push(airTempAt(wx, h));
    const lo = Math.min(...temps), hi = Math.max(...temps);
    items.push(lo > COLD_LIMIT_C
      ? ['go', 'Thermal', `Air ${lo.toFixed(0)} to ${hi.toFixed(0)} °C during the walk (REMS, sol ${wx.sol}).`]
      : ['caution', 'Thermal', `Down to ${lo.toFixed(0)} °C. Check suit heater margins (REMS, sol ${wx.sol}).`]);
  }

  items.push(t0 >= DAY_START_H && t1 <= DAY_END_H
    ? ['go', 'Daylight', `Outside ${fmtClock(t0)} to ${fmtClock(t1)}, inside the ${DAY_START_H}:00 to ${DAY_END_H}:00 window.`]
    : ['caution', 'Daylight', `Outside ${fmtClock(t0)} to ${fmtClock(t1)}. Before ${DAY_START_H}:00 or after ${DAY_END_H}:00 it gets much colder.`]);

  const dose = config.radiation_mSv_per_day * totalH / config.sol_hours;
  items.push(['go', 'Radiation', `${dose.toFixed(3)} mSv, ${(100 * totalH / config.sol_hours).toFixed(0)}% of a full sol on the surface (Curiosity RAD).`]);
  return items;
}

export function renderSummary() {
  const { plan, config } = state;
  const box = $('summary');
  const r = plan?.chosen;
  box.hidden = $('elevBox').hidden = !r;   // no route, no verdict (the waypoint hint says what to do)
  $('player').hidden = !r;
  $('btnPOV').disabled = !r;
  // map legend for the comparison route (drawn only when it differs from yours)
  const ghostShown = !!(r && plan.ghost && plan.ghost.path.join() !== r.path.join());
  $('legendRoute').hidden = !r;
  $('legendGhost').parentElement.hidden = !ghostShown;
  if (ghostShown) $('legendGhost').textContent = priorityName(plan.ghostPriority).toLowerCase();
  $('btnPOV').title = r ? 'Walk the route at eye level' : 'Plan a route first';
  if (!r) leavePov();   // no route to stand on: back to the map or 3D view you came from
  box.className = 'summary';
  if (!r) {
    drawTempChart();
    return;
  }

  // Go / no-go
  const items = poll(r);
  const nogo = items.filter((i) => i[0] === 'nogo').length;
  const cautions = items.filter((i) => i[0] === 'caution').length;
  box.classList.add(nogo ? 'nogo' : cautions ? 'caution' : 'go');
  // orange card = go, but some system needs care: say so, not just "Go" (small second line, so it fits
  // the header next to the folded "distance · time" line too)
  $('verdict').innerHTML = nogo ? 'No-go' : cautions ? 'Go<small>with caution</small>' : 'Go';
  const callWord = { go: 'Go', caution: 'Caution', nogo: 'No-go' };
  $('poll').innerHTML = items.map(([lvl, sys, detail]) =>
    `<li class="${lvl}"><span class="sys">${sys}</span><span class="call">${callWord[lvl]}</span>` +
    `${lvl === 'go' ? '' : `<small>${detail}</small>`}</li>`).join('');

  // Stats
  const s = r.stats, totalH = totalHours(r);
  $('sDist').textContent = fmtDist(s.total);
  $('sTime').textContent = fmtH(totalH);
  $('sUp').textContent = `${Math.round(s.up)} m`;
  $('sRad').textContent = `${(config.radiation_mSv_per_day * totalH / config.sol_hours).toFixed(3)} mSv`;
  $('sEnd').textContent = fmtClock(startHour() + totalH);
  $('sumLine').textContent = `${fmtDist(s.total)} · ${fmtH(totalH)}`;   // shown when the card is folded
  $('sOrder').innerHTML = r.legs.map((l) =>
    `<li><i style="background:${l.color}"></i>${pointName(l.fromPoint)} to ${pointName(l.toPoint).toLowerCase()}` +
    `<span>${fmtDist(s.dist[l.to] - s.dist[l.from])}</span></li>`).join('');

  drawElevChart(r);
  drawTempChart();
  fitSummary();
}

/** Keep the verdict card above the cards at the bottom centre (waypoints, player, view switch) when
 *  the view is narrow enough for them to sit under it: it gets shorter and scrolls instead. */
export function fitSummary() {
  const card = $('summary');
  if (card.hidden || !card.offsetParent) return;
  const c = card.getBoundingClientRect();
  let bottom = card.parentElement.getBoundingClientRect().bottom - 12;
  for (const el of document.querySelectorAll('.centre-stack > *, #player, #hud, .viewdock')) {
    const r = el.getBoundingClientRect();
    if (!r.height || r.left >= c.right || r.right <= c.left) continue;   // hidden, or not under the card
    bottom = Math.min(bottom, r.top - 10);
  }
  card.style.maxHeight = `${Math.max(56, bottom - c.top)}px`;
  // too short to show everything: keep distance and time in the header, next to the verdict
  card.classList.toggle('tight', card.scrollHeight > card.clientHeight + 1);
}

export function setupSummaryFit() {
  const ro = new ResizeObserver(() => fitSummary());
  ['.stage', '.centre-stack', '#player', '#summary'].forEach((q) => ro.observe(document.querySelector(q)));
}
