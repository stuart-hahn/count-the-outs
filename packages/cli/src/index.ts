import { SPOTS } from './spots.js';
import { runSession } from './runner.js';

const args = process.argv.slice(2);
let count = 20;
let spotFilter: string | null = null;

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === '--count' && i + 1 < args.length) {
    const n = Number(args[i + 1]);
    if (!Number.isInteger(n) || n < 1) {
      console.error(`--count must be a positive integer, got: ${args[i + 1]}`);
      process.exit(1);
    }
    count = n;
    i++;
  } else if (arg === '--spot' && i + 1 < args.length) {
    spotFilter = args[i + 1]!;
    i++;
  }
}

if (spotFilter !== null && !SPOTS.some(s => s.spot === spotFilter)) {
  console.error(
    `Unknown spot: "${spotFilter}". Valid spots:\n  ${SPOTS.map(s => s.spot).join('\n  ')}`,
  );
  process.exit(1);
}

await runSession(count, spotFilter);
