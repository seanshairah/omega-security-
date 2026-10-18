/**
 * One place that decides which raster tiles the Leaflet maps use. With NEXT_PUBLIC_MAPTILER_KEY
 * set, MapTiler's Streets tiles are used (clearer labels, commercial terms); otherwise the
 * OpenStreetMap public tiles. Tiles are only pictures: the device position always comes from
 * the browser Geolocation API or a guard phone, never from the map provider.
 */
export function tileLayerConfig(): { url: string; attribution: string; maxZoom: number } {
  const key = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (key) return { url: `https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`, attribution: '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>', maxZoom: 20 };
  return { url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 19 };
}

export const tileProviderName = () => (process.env.NEXT_PUBLIC_MAPTILER_KEY ? "MapTiler" : "OpenStreetMap");
