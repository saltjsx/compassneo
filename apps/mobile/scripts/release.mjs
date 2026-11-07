// Ships the phone app (convex/releases.ts says how it updates).
//
//   bun run release apk ["what's new"]   builds an APK on EAS (preview profile), waits for it, then publishes it so
//                                        installed apps show the update card and /android points at it
//   bun run release ota "what's new"     sends the current JS over the air (EAS Update) to the APK and the TestFlight
//                                        build, each on its own channel; it reaches only builds whose native
//                                        fingerprint matches, so anything native needs `apk` (and a new iOS build)
//
// Always against prod: `eas update` bundles here, where .env.local points at the dev deployment.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const PROD = "https://charming-alligator-791.convex.cloud";
const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, "..");
const backend = resolve(app, "../../packages/backend");
const env = { ...process.env, EXPO_PUBLIC_CONVEX_URL: PROD };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

// On Windows npx is a .cmd, so it runs through cmd.exe, which joins the args with bare spaces: quote any arg with a
// space or a quote in it (a message, the release's JSON), escaping its quotes the way node reads them back.
const win = process.platform === "win32";
const quote = a => (win && /[\s"]/.test(a) ? `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"` : a);

const run = (args, cwd, capture = false) =>
  execFileSync(npx, args.map(quote), { cwd, env, stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit", encoding: "utf8", shell: win });

const [what, note] = process.argv.slice(2);

if (what === "apk") {
  console.log("Building the APK on EAS (about 15 minutes)…");
  const out = run(["--yes", "eas-cli@latest", "build", "-p", "android", "--profile", "preview", "--non-interactive", "--wait", "--json"], app, true);
  const [build] = JSON.parse(out.slice(out.indexOf("[")));
  if (build?.status !== "FINISHED") throw new Error(`The build did not finish: ${build?.status ?? "no build"}`);
  const release = { platform: "android", build: Number(build.appBuildVersion), version: build.appVersion, url: build.artifacts.buildUrl, ...(note ? { notes: note } : {}) };
  run(["convex", "run", "--prod", "releases:publish", JSON.stringify(release)], backend);
  console.log(`Published Android ${release.version} (${release.build}): ${release.url}`);
  console.log(`Everyone's link: ${PROD.replace(".convex.cloud", ".convex.site")}/android`);
} else if (what === "ota") {
  if (!note) throw new Error('Say what\'s in it: bun run release ota "Fixes the timetable"');
  for (const channel of ["preview", "production"]) {
    console.log(`Sending the update to ${channel}…`);
    run(["--yes", "eas-cli@latest", "update", "--channel", channel, "--environment", channel, "--message", note, "--non-interactive"], app);
  }
} else {
  console.log('bun run release apk ["what\'s new"]   or   bun run release ota "what\'s new"');
  process.exit(1);
}
