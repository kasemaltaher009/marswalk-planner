/* Loading the files made by prepare_data.py (web/data/). */
import { DATA } from './state.js';

export async function getJSON(name, optional = false) {
  try {
    const res = await fetch(DATA + name);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (err) {
    if (optional) { console.warn(`Optional file ${name} not loaded:`, err); return null; }
    throw new Error(`Could not load ${DATA}${name} (${err.message}). Run prepare_data.py and serve web/ with Live Server.`);
  }
}

/** Everything the app needs. Weather and Curiosity's route are optional. */
export async function loadAll() {
  const [config, costGrid, weather, curiosity] = await Promise.all([
    getJSON('config.json'), getJSON('cost_grid.json'),
    getJSON('weather.json', true), getJSON('curiosity.geojson', true),
  ]);
  return { config, costGrid, weather, curiosity };
}
