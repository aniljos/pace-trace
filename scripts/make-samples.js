import { writeFileSync } from 'node:fs';
import { sampleSteady, sampleNegative } from '../src/lib/sample.js';

writeFileSync(new URL('../samples/sunday-long-run.gpx', import.meta.url), sampleSteady());
writeFileSync(new URL('../samples/tempo-run.gpx', import.meta.url), sampleNegative());
console.log('Wrote samples/sunday-long-run.gpx and samples/tempo-run.gpx');
