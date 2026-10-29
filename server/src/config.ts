import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Fonts } from './ffmpeg-args.ts';

export interface Config {
  port: number;
  dataDir: string;
  publicHost: string | null;
  timeZone: string;
  geocoder: 'nominatim' | 'off';
  placeLanguage: string;
  fonts: Fonts;
  webDist: string | null;
  version: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** Environment variables (SPEC §7). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const webDist = env.WEB_DIST ?? path.resolve(here, '../../web/dist');
  return {
    port: Number(env.PORT ?? 8080),
    dataDir: path.resolve(env.DATA_DIR ?? '/data'),
    publicHost: env.PUBLIC_HOST?.trim() || null,
    timeZone: env.TZ?.trim() || 'UTC',
    geocoder: env.GEOCODER === 'off' ? 'off' : 'nominatim',
    placeLanguage: env.PLACE_LANGUAGE?.trim() || 'en',
    fonts: resolveFonts(env),
    webDist: existsSync(path.join(webDist, 'index.html')) ? webDist : null,
    version: env.APP_VERSION ?? '0.1.0',
  };
}

const LATIN = [
  '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/noto/NotoSans-Regular.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];
const CJK = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
];

function resolveFonts(env: NodeJS.ProcessEnv): Fonts {
  const pick = (override: string | undefined, list: string[]) =>
    override ?? list.find((f) => existsSync(f)) ?? list[0]!;
  const latin = pick(env.FONT_LATIN, LATIN);
  const cjk = env.FONT_CJK ?? CJK.find((f) => existsSync(f)) ?? latin;
  return { latin, cjk };
}
