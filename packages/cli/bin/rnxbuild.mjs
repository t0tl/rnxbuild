#!/usr/bin/env node
import { main } from "../dist/index.js";
main(process.argv).catch((err) => {
  process.stderr.write(`rnxbuild: ${err.stack ?? err}\n`);
  process.exit(1);
});
