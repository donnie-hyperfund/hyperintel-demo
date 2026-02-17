import { execSync } from "node:child_process";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("-"));
const flags = args.filter((a) => a.startsWith("-")).join(" ");
const dir = name ? `tests/scenarios/${name}/` : "tests/scenarios/";

execSync(`vitest ${dir} --run ${flags}`.trim(), { stdio: "inherit" });
