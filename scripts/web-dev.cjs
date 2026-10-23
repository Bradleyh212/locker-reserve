const path = require("node:path");
const preload = path.join(__dirname, "dev-fetch-timeout.cjs");
process.env.NODE_OPTIONS =
  `${process.env.NODE_OPTIONS || ""} --require ${JSON.stringify(preload)}`.trim();
process.env.NODE_DISABLE_COMPILE_CACHE = "1";
process.env.NEXT_TELEMETRY_DISABLED = "1";
require(preload);
const cli = require.resolve("../services/web/node_modules/next/dist/bin/next");
process.argv = [
  process.execPath,
  cli,
  "dev",
  "--webpack",
  "--disable-source-maps",
  ...process.argv.slice(2),
];
require(cli);
