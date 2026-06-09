/**
 * A couple of server-side knobs that need to persist but don't deserve a
 * database table. Stored as JSON next to the other runtime state in data/.
 * Right now it's just the "keep multiple models loaded at once" preference.
 *
 * Server-only.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AppSettings {
  /** Let more than one local model stay in memory at the same time. Off by
   *  default so a modest machine never ends up with two models fighting for
   *  VRAM and crashing. Only meaningful (and only offered in the UI) when the
   *  hardware can actually take it. */
  multiModel: boolean;
}

const DEFAULTS: AppSettings = { multiModel: false };

const FILE = process.env.CHAKOR_APP_SETTINGS ?? path.join(process.cwd(), 'data', 'app-settings.json');

export async function readAppSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(FILE, 'utf8'));
    return { ...DEFAULTS, ...raw, multiModel: Boolean(raw.multiModel) };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeAppSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await readAppSettings()), ...patch };
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}
