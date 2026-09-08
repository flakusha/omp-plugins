#!/usr/bin/env bun
// install.ts — Install the oh-my-pi integration bundle into a target omp
// profile root. TypeScript port of scripts/install.sh; all behavior lives in
// install-lib.ts.
import { InstallerError, runInstall } from "./install-lib";

try {
  process.exitCode = await runInstall(process.argv.slice(2));
} catch (error) {
  if (error instanceof InstallerError) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = error.exitCode;
  } else {
    throw error;
  }
}
