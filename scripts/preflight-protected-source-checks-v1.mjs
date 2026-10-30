#!/usr/bin/env node
// Local, read-only snapshot inspection. Not registered as a remote action and
// never a substitute for fresh protected merge, environment or lease evidence.
import {readFileSync,statSync} from 'node:fs';
import {inspectProtectedSourceCheckPreflightV1} from '../shared/agents/protectedSourceCheckPreflightV1.mjs';
try {
 if (![3,4].includes(process.argv.length)) throw Error();
 const inputPath=process.argv[2];
 if (statSync(inputPath).size>2*1024*1024) throw Error();
 const input=JSON.parse(readFileSync(inputPath,'utf8'));
 if (process.argv[3]) {
  if (!input.independentReview || statSync(process.argv[3]).size>256*1024) throw Error();
  input.independentReview.archiveBytes=readFileSync(process.argv[3]);
 }
 const result=inspectProtectedSourceCheckPreflightV1(input);
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 process.exitCode=result.checkSnapshotAdmissible?0:1;
} catch {
 process.stderr.write('Protected source check preflight requires a bounded snapshot and optional review ZIP.\n');
 process.exitCode=1;
}
