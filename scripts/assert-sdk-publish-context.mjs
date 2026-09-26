#!/usr/bin/env node
/**
 * prepublishOnly gate for @telemetry-tracker/* packages.
 * Blocks accidental `npm publish` / `pnpm publish` from a package folder
 * (which would skip release guards and could ship workspace:* deps).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoWorkspaceProtocolDeps,
  assertSdkReleasePublishEnv,
} from "./lib/publish-guards.mjs";

assertSdkReleasePublishEnv();

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8"));
assertNoWorkspaceProtocolDeps(pkg);
