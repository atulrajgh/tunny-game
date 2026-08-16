// Bump the app version in frontend/public/settings.json.
// Dates are computed from UTC so developers in any time zone
// (US CDT, AEST, ...) derive the same version for the same day.
//
// Format: <yearPart>.<month>.<ddnn>
//   yearPart = UTC year - 2025  (2026 -> 1, 2027 -> 2, ...)
//   month    = UTC month 1..12
//   dd       = UTC day of the change (01..31)
//   nn       = count of changes that UTC day (01..99, capped at 99)
//
// Usage:  node bump-version.mjs            (bump and write)
//         node bump-version.mjs --dry-run  (print next version only)
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const root = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(root, 'frontend', 'public', 'settings.json');

const now = new Date();
const yearPart = now.getUTCFullYear() - 2025;
const month = now.getUTCMonth() + 1;
const day = now.getUTCDate();

const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
const [curYear, curMonth, curDayCount] = settings.version.split('.').map(Number);
const curDay = Math.floor(curDayCount / 100);
const curCount = curDayCount % 100;

const sameUtcDay = curYear === yearPart && curMonth === month && curDay === day;
const count = sameUtcDay ? Math.min(curCount + 1, 99) : 1;

const nextVersion = `${yearPart}.${month}.${String(day).padStart(2, '0')}${String(count).padStart(2, '0')}`;

if (dryRun) {
  console.log(`UTC now:     ${now.toISOString()}`);
  console.log(`Current:     ${settings.version}`);
  console.log(`Next:        ${nextVersion}`);
} else {
  settings.version = nextVersion;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log(`Bumped ${settingsPath}`);
  console.log(`UTC now:   ${now.toISOString()}`);
  console.log(`New:       ${nextVersion}`);
}