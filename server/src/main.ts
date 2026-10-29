import { find } from 'geo-tz';
import path from 'node:path';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { candidates, describeEncoder, detectEncoders } from './encoders.ts';
import { encoderProbeArgs } from './ffmpeg-args.ts';
import { run } from './ffmpeg.ts';
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

const encoders = await detectEncoders(candidates(process.platform, config.encoder, config.vaapiDevice), (enc, preset) =>
  run('ffmpeg', encoderProbeArgs(enc, preset)).then(
    () => true,
    () => false,
  ),
);

const { server, renderer } = await buildApp(config, {
  encoders,
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
    `Render ${r.state}: ${r.clips} clips, ${Math.round(r.duration)} s, ${r.preset} preset, ${r.encoder} encoder, ` +
      `${t.total} s total (loudness ${t.loudness} s, clips ${t.segments} s, join ${t.join} s)`,
  );
});

await server.listen({ port: config.port, host: '0.0.0.0' });
console.log(`videos-to-one listening on http://localhost:${config.port}`);
if (config.publicHost) console.log(`Phone URL: http://${config.publicHost}:${config.port}`);
else console.log('PUBLIC_HOST is not set: the phone URL must be typed by hand.');
console.log(`Final encoder: compatible → ${describeEncoder(encoders.compatible)}, original → ${describeEncoder(encoders.original)}`);
if (!config.webDist) console.log('Web app not built (run `npm run build`); API only.');

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close().finally(() => process.exit(0));
  });
}
