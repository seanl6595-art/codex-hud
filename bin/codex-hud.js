#!/usr/bin/env node
'use strict';
require('../lib/cli').main().catch(error => {
  process.stderr.write(`codex-hud: ${error.message}\n`);
  process.exitCode = 1;
});
