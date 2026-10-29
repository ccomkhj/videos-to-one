import { find } from 'geo-tz';
import path from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { NominatimGeocoder, noGeocoder } from './geocode.ts';

const config = loadConfig();

const geocoder =
  config.geocoder === 'off'
    ? noGeocoder
    : new NominatimGeocoder({
        cacheFile: path.join(config.dataDir, 'cache', 'geocode.json'),
        language: config.placeLanguage,
        userAgent: `videos-to-one/${config.version} (+https://github.com/ccomkhj/videos-to-one)`,
      });

const { server, renderer } = await buildApp(config, {
  geocoder,
  tzAt: ({ lat, lon }) => {
    try {
      return find(lat, lon)[0];
    } catch {
      return undefined;
    }
  },
});

renderer.on('finished', (r) => {
  const t = r.seconds;
  console.log(
    `Render ${r.state}: ${r.clips} clips, ${Math.round(r.duration)} s, ${r.preset} preset, ` +
      `${t.total} s total (loudness ${t.loudness} s, clips ${t.segments} s, join ${t.join} s)`,
  );
});

await server.listen({ port: config.port, host: '0.0.0.0' });
console.log(`videos-to-one listening on http://localhost:${config.port}`);
if (config.publicHost) console.log(`Phone URL: http://${config.publicHost}:${config.port}`);
else console.log('PUBLIC_HOST is not set: the phone URL must be typed by hand.');
if (!config.webDist) console.log('Web app not built (run `npm run build`); API only.');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close().finally(() => process.exit(0));
  });
}
