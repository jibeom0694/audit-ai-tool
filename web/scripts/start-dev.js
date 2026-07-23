const path = require("path");

// Ensures process.cwd() is the `web` project root regardless of where this
// script is invoked from, so Next.js and app code (e.g. src/lib/dart.ts's
// local cache path) resolve paths consistently.
const webDir = path.join(__dirname, "..");
process.chdir(webDir);
process.argv = [process.argv[0], process.argv[1], "dev"];

require(path.join(webDir, "node_modules", "next", "dist", "bin", "next"));
