/**
 * CLI content gate.
 *
 *   bun run validate:content
 *
 * Exits non-zero when a manifest is broken so it can be used as a deploy
 * blocker. Run before `convex dev --once` — publishing malformed content to a
 * trainee device is worse than failing a build.
 */

import { validateAllModules, formatIssues } from "../src/lib/validate-content";
import { MODULE_CODES, MODULES } from "../src/lib/modules";
import { SHIPPED_LOCALES } from "../src/lib/types";

const issues = validateAllModules();

let stepCount = 0;
let criticalCount = 0;
let choiceCount = 0;

for (const code of MODULE_CODES) {
  const m = MODULES[code]!;
  stepCount += m.steps.length;
  criticalCount += m.steps.filter((s) => s.critical).length;
  choiceCount += m.steps.reduce((n, s) => n + (s.choices?.length ?? 0), 0);
}

console.log(`KAVACH content check — ${MODULE_CODES.length} modules, ${stepCount} steps`);
console.log(
  `  ${criticalCount} critical · ${choiceCount} decision choices · locales: ${SHIPPED_LOCALES.join(", ")}`,
);

if (issues.length > 0) {
  console.error(`\nFAIL — ${issues.length} content issue(s):\n${formatIssues(issues)}`);
  process.exit(1);
}

console.log("OK — every step has en+hi, one correct answer, and an approved critical flag.");
