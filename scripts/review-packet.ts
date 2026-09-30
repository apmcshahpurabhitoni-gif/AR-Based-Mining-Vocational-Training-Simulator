/**
 * Generate the safety review packet.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 *
 * `docs/12` and `docs/13` both end with a review gate, and both call it a
 * **release blocker**: a qualified mining safety reviewer must sign off the
 * procedures and the language before anyone can claim the content is validated.
 * That review has not happened, and the thing standing in front of it is not the
 * code — it is the absence of anything to review. A safety engineer opening this
 * repository finds a spec that says "review the extinguisher mapping, the PASS
 * instruction, the alarm/withdrawal procedure, the assembly wording, and the
 * Hindi/Santali safety language", and then has to go and read JSON to find out
 * what those actually are.
 *
 * So the packet is the review, laid out: every spec requirement next to the
 * content that implements it, every wrong answer with the misconception it is
 * supposed to represent, every hint, both languages, and — the part that matters
 * most — an explicit, numbered list of what is *missing* and therefore what the
 * reviewer is being asked to supply.
 *
 * ---------------------------------------------------------------------------
 * What it must never do
 * ---------------------------------------------------------------------------
 *
 * This generator transcribes and asks. It does not judge, and it cannot:
 * `docs/13` states that "exact gas types, detector thresholds, respiratory
 * protection rules, isolation procedures, confined-space controls, and re-entry
 * conditions must come from approved mine procedures and qualified review." Every
 * line in the output is either a quotation of the spec, a quotation of the
 * manifest, or a question. Nothing in here asserts that any of it is correct.
 *
 * The temptation to write "this looks safe" is exactly the failure mode this
 * project has been guarding against since a fire hose reel in a gas-detection
 * room recorded a gas-safety failure. A generator that opines is a generator
 * that can be wrong about safety, and nobody would know.
 *
 * ---------------------------------------------------------------------------
 * Generated, not written
 * ---------------------------------------------------------------------------
 *
 * The file in `docs/` is generated from the manifests, and a test compares the
 * committed file against a fresh run, so it cannot quietly go stale — the same
 * arrangement as `targets.mind` against its compiler. A packet that was accurate
 * in March and is not now is worse than no packet, because it is trusted.
 *
 * It carries a fingerprint of the manifest content instead of a date, so
 * regenerating unchanged content produces an unchanged file.
 *
 * Run:    bun run scripts/make-review-packet.ts
 * Output: docs/R9-SAFETY-REVIEW-PACKET.md
 */

import { createHash } from "node:crypto";
import { MODULES, MODULE_CODES, APPROVED_CRITICAL_STEPS } from "../src/lib/modules";
import { INTERACTABLES, MARKERS, distractorsFor } from "../src/lib/markers";
import { DECLARED_DEVIATIONS, SPECS, type SpecStep } from "../src/lib/spec-tables";
import { SHIPPED_LOCALES, type Localised } from "../src/lib/types";

const OUT = "docs/R9-SAFETY-REVIEW-PACKET.md";

/**
 * Render the packet. Pure: no clock, no filesystem, no randomness, so a test can
 * render it and compare against the committed file without touching the working
 * tree. `scripts/make-review-packet.ts` is the part that writes.
 */
export function renderReviewPacket(): string {

  // ---------------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------------

  /** One line of prose, safe inside a markdown table cell. */
  const cell = (value: string | undefined): string => {
    if (value === undefined || value.trim() === "") return "—";
    return value.replace(/\|/g, "\\|").replace(/\n+/g, " ");
  };

  /** Block quote, for spec text that must not be paraphrased. */
  const quote = (value: string): string =>
    value
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");

  /** A localised string, both shipped languages, labelled. */
  const localised = (value: Localised | undefined): string => {
    if (!value) return "—";
    return SHIPPED_LOCALES.map((locale) => `**${locale}** — ${value[locale] ?? "_(missing)_"}`).join(
      "\n\n",
    );
  };

  /** The id-prefix deviation key for a module, if its spec numbers steps differently. */
  const idDeviationFor = (code: string): string | undefined => {
    const spec = SPECS[code];
    if (!spec) return undefined;
    const renumbered = spec.rows.some((row, i) => row.specId !== spec.manifestIds[i]);
    return renumbered ? `${code}/${spec.manifestIds[0]!.replace(/-0\d$/, "")}n.ids` : undefined;
  };

  /** Fingerprint of everything the packet is a statement about. */
  const fingerprint = (): string => {
    const canonical = JSON.stringify(
      Object.fromEntries(MODULE_CODES.map((code) => [code, MODULES[code]!.version])),
    );
    return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
  };

  // ---------------------------------------------------------------------------
  // Derivation — the questions, computed rather than written by hand
  // ---------------------------------------------------------------------------

  interface Question {
    id: string;
    /** The question, as a sentence ending in a question mark. */
    ask: string;
    /** Why it is open. Quoted or derived, never assumed. */
    because: string;
    /** What a reviewer supplies that closes it. */
    closesWith: string;
  }

  const questions: Question[] = [];
  let questionNumber = 0;

  const ask = (ask: string, because: string, closesWith: string): void => {
    questionNumber += 1;
    questions.push({ id: `Q${questionNumber}`, ask, because, closesWith });
  };

  /** Every step flagged as awaiting review, across all modules. */
  const pendingSteps = MODULE_CODES.flatMap((code) =>
    MODULES[code]!.steps
      .filter((step) => step.pendingSafetyReview)
      .map((step) => ({ code, step })),
  );

  /** The deviation keys that describe a per-step field, not the id prefix. */
  const fieldDeviations = Object.keys(DECLARED_DEVIATIONS).filter(
    (key) => !key.includes("-0n."),
  );

  // -- Questions from the pending steps ---------------------------------------
  for (const { code, step } of pendingSteps) {
    const spec = SPECS[code]!;
    const index = spec.manifestIds.indexOf(step.id);
    const row: SpecStep | undefined = spec.rows[index];

    ask(
      `What is the approved procedure for ${code} step ${index! + 1} (${step.id})?`,
      row
        ? `docs/13 requires: "${row.behaviour}". That behaviour is a release blocker and the content does not yet exist.`
        : `The step is flagged pendingSafetyReview, so no approved procedure exists.`,
      "The ordered actions, with the equipment and the wording a trainee would actually be given.",
    );

    ask(
      `Which of the candidate answers to ${step.id} is correct, and in what scenario?`,
      `${step.id} currently has ${(step.choices ?? []).length} candidates, none marked correct, because the scenario that decides between "withdraw" and "remain outside" has not been defined. The spec says "as instructed" — it does not say who instructs, or in which case.`,
      "One correct answer, and the condition under which it is correct. The other candidates then need misconception text (C8).",
    );

    ask(
      `Should ${step.id} be an \`act\` step or a \`decide\` step?`,
      DECLARED_DEVIATIONS[`${code}/${step.id}.kind`] ?? "The kind is not declared as a deviation.",
      "A ruling. The implementation models it as `decide` because the spec's own wording is a choice between two outcomes, and an `act` would assert an order the spec never states.",
    );
  }

  // -- Questions from the declared deviations ---------------------------------
  for (const key of fieldDeviations) {
    const [where, field] = key.split(".") as [string, string];
    const [code, stepId] = where.split("/") as [string, string];
    const spec = SPECS[code]!;
    const index = spec.manifestIds.indexOf(stepId);
    const row = spec.rows[index];

    // A blocked step already gets a dedicated "act or decide?" question from the
    // loop above, phrased in terms of what the reviewer is being asked to supply.
    // Asking it a second time here would print the declared reason twice and read
    // as two separate issues.
    const alreadyAsked = pendingSteps.some((p) => `${p.code}/${p.step.id}` === where);
    if (alreadyAsked) continue;

    if (field === "kind" && stepId === "B-03") {
      ask(
        `Where should "raise warning / communicate the emergency" be taught in ${code}?`,
        `docs/13 step 3 is an \`act\` for raising the warning. The shipped step 3 is a \`decide\` on buddy arrangement, which reads as step 2's "select the safe immediate response" rather than step 3. The consequence is that no step in GAS teaches a trainee to raise a warning.`,
        "Either a new step, or a ruling that the warning is covered elsewhere. As shipped, that behaviour is untaught.",
      );
      continue;
    }

    if (field === "kind" && stepId === "B-05") {
      ask(
        `Should ${stepId} be a \`decide\` (select an isolation action) or an \`act\` (perform the isolation sequence)?`,
        DECLARED_DEVIATIONS[key]!,
        "A ruling. Both readings are defensible; the manifest implements one of them.",
      );
      continue;
    }

    ask(
      `Does \`${stepId}\` need correcting before release, or is the declared difference accepted?`,
      row
        ? `The spec makes this step "${row.behaviour}" and types it \`${row.kind}\`. ${DECLARED_DEVIATIONS[key]!}`
        : DECLARED_DEVIATIONS[key]!,
      "Either a correction in the manifest, or an accepted deviation recorded in `DECLARED_DEVIATIONS` with the reviewer's name against it.",
    );
  }

  ask(
    "Should GAS step ids be renamed from B-0n to the G-0n used in the spec?",
    DECLARED_DEVIATIONS["GAS/B-0n.ids"]!,
    "A ruling. Renaming is a data migration because the ids key stored attempt records and the re-check sampler, so it must not happen casually.",
  );

  // -- Questions that follow from the spec's own safety boundaries -------------
  for (const [code, spec] of Object.entries(SPECS)) {
    const module = MODULES[code]!;
    for (const boundary of spec.safetyBoundary ?? []) {
      ask(
        `Confirm the ${code} content does not contradict this, and sign it off: "${boundary}"`,
        `Stated in ${spec.doc} as a boundary the content must not cross. Nothing in the build can check this — it is a judgement about the wording.`,
        "A signed-off statement, or the sentence in the content that needs changing.",
      );
    }

    const moduleCritical = module.steps.filter((s) => s.critical).map((s) => s.id);
    ask(
      `Are ${code}'s critical steps correctly identified?`,
      `${code} flags ${moduleCritical.join(", ") || "none"} as critical. A first-attempt miss on any of them blocks qualification regardless of overall score, and the flag lives in APPROVED_CRITICAL_STEPS, which validate-content enforces against the manifest.`,
      "Confirmation that a first-try miss on these steps is the thing that should cost a certificate, and that no step is missing from the list.",
    );
  }

  // -- Questions from the locale contract --------------------------------------
  ask(
    "Is the Hindi wording safe, and does it need a native-speaker review?",
    `Every string ships in en and hi, and validate-content fails the build if a shipped locale is missing one. Nothing in the build can judge whether a Hindi rendering of a safety instruction is itself safe — particularly the extinguisher types, the withdrawal wording, and the misconceptions.`,
    "A language reviewer's sign-off per module, which docs/12 lists explicitly in its review gate.",
  );

  ask(
    "What is the plan for the reserved \`sat\` slot?",
    "`sat` is declared in the type system and has no content. docs/10 requires it before full target-language compliance can be claimed, and docs/15 puts it in Phase 6. It has never been machine-translated, and it must not be.",
    "Either reviewed Santali content, or an explicit statement that the pilot is Hindi-only and the SIH claim is scoped accordingly.",
  );

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  const out: string[] = [];
  const push = (...lines: string[]): void => {
    out.push(...lines, "");
  };

  /**
   * A markdown table, emitted as one block.
   *
   * Not `push()` per row: that puts a blank line between the header and its
   * separator, and a table with a blank line in it is not a table. It renders as
   * three paragraphs of pipe characters, which is precisely the wrong outcome for
   * the one document a reviewer is guaranteed to read closely.
   */
  const table = (...rows: string[]): void => {
    out.push(rows.join("\n"), "");
  };

  push(
    "# KAVACH — Safety Review Packet",
    "",
    "**For:** the qualified mining safety reviewer named as a release blocker in [docs/12](./12-FIRE-MODULE-SPEC.md) and [docs/13](./13-GAS-MODULE-SPEC.md).  ",
    `**Generated from:** the shipped manifests, fingerprint \`${fingerprint()}\`.  `,
    `**Manifest versions:** ${MODULE_CODES.map((c) => `${c} ${MODULES[c]!.version}`).join(", ")}.  `,
    "**Do not edit this file.** It is generated: `bun run make:packet`. A test compares it against a",
    "fresh run, so an edited copy fails the build.",
  );

  push(
    "## What you are being asked to review",
    "",
    "Both module specifications close with a review gate and call it a **release blocker**. Quoted:",
    "",
  );
  for (const [code, spec] of Object.entries(SPECS)) {
    push(`**${code}** (${spec.doc} — *${spec.title}*)`, "");
    push(quote(spec.reviewGate.join("\n\n")), "");
  }

  push(
    "Until that review is recorded, no certificate issues for either module: the gate requires every",
    "bundled module to meet its pass score, and a module whose content is unapproved cannot be",
    "certified. That is the gate working, and it is why this packet exists.",
    "",
    "**How to record a decision.** Edit the manifest — never this file. Then delete the step's entry",
    "from `PENDING_SAFETY_REVIEW` in `src/lib/validate-content.ts` if it was blocked, run",
    "`bun run make:packet`, and let `bun test` confirm. The conformance test in",
    "`src/lib/spec-conformance.test.ts` will fail if an edit moves a step away from the spec table",
    "without a declared reason, which is the check that keeps a correction honest.",
  );

  // -- Module status -----------------------------------------------------------
  push("## Module status", "");
  const statusRows: string[] = [
    "| Module | Spec | Steps | Critical | Blocked steps | Matches spec | Reviewable today |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const code of MODULE_CODES) {
    const module = MODULES[code]!;
    const spec = SPECS[code]!;
    const blocked = module.steps.filter((s) => s.pendingSafetyReview).map((s) => s.id);
    const deviations = spec.manifestIds.filter((id) => fieldDeviations.includes(`${code}/${id}.kind`));
    const pending = blocked.length > 0;
    statusRows.push(
      `| \`${code}\` | ${spec.doc} | ${module.steps.length} | ${
        module.steps.filter((s) => s.critical).length
      } | ${blocked.length ? cell(blocked.join(", ")) : "—"} | ${
        deviations.length ? `**${deviations.length} declared deviation(s)**` : "yes, exactly"
      } | ${pending ? "**no — see below**" : "yes, pending your sign-off"} |`,
    );
  }
  table(...statusRows);
  push(
    "Both modules are structurally complete against their spec tables, and both are **unreviewed",
    "content**. Structural conformance is proven on every build; safety is not, and no amount of",
    "testing can substitute for it.",
  );

  // -- Blocking items ----------------------------------------------------------
  push("## Blocking items", "");
  if (pendingSteps.length === 0) {
    push("None. No step is currently awaiting review.");
  } else {
    push(
      "These are the items with no content at all. They are not wrong — they are absent, and the",
      "build refuses to paper over that.",
    );
    for (const { code, step } of pendingSteps) {
      const spec = SPECS[code]!;
      const index = spec.manifestIds.indexOf(step.id);
      const row = spec.rows[index];
      push(`### \`${code}/${step.id}\` — step ${index + 1} of ${spec.rows.length}`, "");
      if (row) {
        push(
          `**What ${spec.doc} requires of this step** (kind \`${row.kind}\`, critical: ${row.critical}):`,
          "",
          quote(row.behaviour),
          "",
        );
      }
      push("**What the build has today:**", "");
      push(
        `- kind \`${step.kind}\`, critical: ${step.critical}, weight ${step.weight ?? 1}`,
        `- candidates: ${(step.choices ?? []).map((c) => `\`${c.id}\``).join(", ") || "—"}`,
        `- correct answers defined: **${(step.choices ?? []).filter((c) => c.correct).length}** (deliberately zero — no answer is approved, so the step cannot be passed even if something presented it)`,
        `- produces no room, is never presented, and cannot be resolved, so the module cannot be completed and cannot be certified`,
      );
      push("");
      push(`**Instruction as shipped**`, "", localised(step.instruction), "");
      push(
        "> The instruction is deliberately the *notice*, not the procedure. The Hindi string exists",
        "> and says the same thing, because a placeholder that only declares itself in English would",
        "> meet a Hindi trainee with unreviewed content that never admitted it.",
      );
    }
  }

  // -- Questions ---------------------------------------------------------------
  push("## Questions for the reviewer", "");
  push(
    "Numbered so an answer can be cited — \"Q3 answered: …\". Derived from the manifests, so an",
    "answer that closes one of these will change this file when regenerated.",
    "",
  );
  for (const q of questions) {
    push(`### ${q.id} — ${q.ask}`, "", `_Why it is open:_ ${q.because}`, "", `_What closes it:_ ${q.closesWith}`, "");
  }

  // -- Step by step ------------------------------------------------------------
  for (const code of MODULE_CODES) {
    const module = MODULES[code]!;
    const spec = SPECS[code]!;
    push(`## ${code} — step by step`, "");
    push(
      `Domain: ${module.domain}.  `,
      `Pass score: ${module.passScore}.  `,
      `Estimated time: ${module.estimatedMinutes} min.`,
    );
    const shapeRows: string[] = [
      "| # | Step | Spec says | Kind | Critical | Weight | Budget |",
      "|---|---|---|---|---|---|---|",
    ];
    spec.rows.forEach((row, i) => {
      const step = module.steps[i]!;
      shapeRows.push(
        `| ${i + 1} | \`${step.id}\` | ${cell(row.behaviour)} | \`${row.kind}\` | ${
          row.critical ? "**yes**" : "no"
        } | ${step.weight ?? 1} | ${((step.expectedMs ?? step.action?.expectedMs ?? 0) / 1000).toFixed(0)}s |`,
      );
    });
    table(...shapeRows);
  const renumbered = spec.rows.some((row, i) => row.specId !== spec.manifestIds[i]);
  if (renumbered) {
    push(
      "",
      "Spec ids for this module are `" +
        spec.rows.map((r) => r.specId).join("`, `") +
        "`; the manifest uses `" +
        spec.manifestIds.join("`, `") +
        "`.",
    );
  }

    spec.rows.forEach((row, i) => {
      const step = module.steps[i]!;
      const deviation = DECLARED_DEVIATIONS[`${code}/${step.id}.kind`];
      const idNote = idDeviationFor(code) ? DECLARED_DEVIATIONS[idDeviationFor(code)!] : undefined;

    push(`### \`${step.id}\` — ${row.behaviour}`, "");
    // One push, so the bullets form a tight list rather than a loose one with a
    // paragraph per line, which is what a reviewer scrolling 12 steps will feel.
    push(
      `- **Spec requirement:** ${row.behaviour}`,
      `- **Spec shape:** kind \`${row.kind}\`, critical: ${row.critical} — **implemented as** kind \`${step.kind}\`, critical: ${step.critical}${
        step.kind === row.kind && step.critical === row.critical ? " (matches)" : " (differs — see below)"
      }`,
      ...(step.pendingSafetyReview
        ? ["- **Status:** awaiting qualified safety review. Not presented, not gradable, blocking."]
        : []),
    );
      if (deviation) push("", `**Declared deviation** — \`${code}/${step.id}.kind\`:`, "", quote(deviation));
      if (idNote && i === 0) {
        push("", "**Declared deviation** — id prefix:", "", quote(idNote));
      }

      push("", `**Instruction**`, "", localised(step.instruction));

      if (step.choices && step.choices.length > 0) {
        push("", "**Options** — one of these is the answer; the rest are misconceptions", "");
        const optionRows: string[] = [
          "| Option | Correct | Misconception | Label (en / hi) |",
          "|---|---|---|---|",
        ];
        for (const choice of step.choices) {
          optionRows.push(
            `| \`${choice.id}\` | ${choice.correct ? "**yes**" : "no"} | ${cell(
              choice.misconception,
            )} | ${cell(choice.label.en)} / ${cell(choice.label.hi)} |`,
          );
        }
        table(...optionRows);
        push("", "**What the trainee is shown after choosing** — this text is safety content too:", "");
        for (const choice of step.choices) {
          push(`- \`${choice.id}\``, "", localised(choice.consequence), "");
        }
      }

      if (step.action && step.action.elements.length > 0) {
        push("", `**Action sequence** — performed in this order, and order is scored:`, "");
        step.action.elements.forEach((el, n) => push(`${n + 1}. \`${el}\``));
      }

      if (step.targets && step.targets.length > 0) {
        push("", "**Targets** — equipment the trainee must find and tap:", "");
        const targetRows: string[] = ["| Target | Label (en / hi) |", "|---|---|"];
        for (const target of step.targets) {
          targetRows.push(`| \`${target.id}\` | ${cell(target.label.en)} / ${cell(target.label.hi)} |`);
        }
        table(...targetRows);
      }

      push("", "**Hints** — using one is recorded and lowers the score:", "");
      if (step.hints.length === 0) {
        push("_None._");
      } else {
        step.hints.forEach((hint, n) => push(`${n + 1}. ${hint.en}  \n   ${hint.hi}`));
      }

      push(
        "",
        "**Failure semantics**",
        "",
        `- kind: \`${step.failure.kind}\``,
        `- requires a retry: ${step.failure.requiresRetry}`,
        `- blocks the certificate: ${step.failure.blocksCertificate}`,
        `- first-attempt miss on this step: ${step.critical ? "blocks certification regardless of score" : "recorded only"}`,
        "",
        "**Failure consequence**",
        "",
        localised(step.failure.consequence),
      );
    });
  }

  // -- Vocabulary --------------------------------------------------------------
  push("## Object vocabulary", "");
  push(
    "A step can only be answered with an id from these lists, and `validate-content` fails the build",
    "if a manifest reaches past them. That is not tidiness: the runner grades a tap on an unknown id",
    "as a miss, so an invented id records a real safety consequence against an object that does not",
    "exist in the module being trained.",
    "",
  );
  for (const code of MODULE_CODES) {
    // Usage has to include distractors, not just a step's own targets: an
    // observe step pulls same-module markers in as distractors, and an id used
    // only that way is very much in play. Counting targets alone reported ids as
    // unused that the room actually draws and the trainee can tap.
    const used = new Set<string>();
    for (const step of MODULES[code]!.steps) {
      for (const target of step.targets ?? []) used.add(target.id);
      for (const choice of step.choices ?? []) used.add(choice.id);
      for (const el of step.action?.elements ?? []) used.add(el);
      for (const id of distractorsFor(
        code,
        (step.targets ?? []).map((t) => t.id),
      )) {
        used.add(id);
      }
    }
    const unused = [...(MARKERS[code] ?? []), ...(INTERACTABLES[code] ?? [])].filter(
      (id) => !used.has(id),
    );
    push(
      `**${code}**`,
      "",
      `- markers: ${(MARKERS[code] ?? []).map((m) => `\`${m}\``).join(", ")}`,
      `- interactables: ${(INTERACTABLES[code] ?? []).map((m) => `\`${m}\``).join(", ")}`,
      `- defined but never placed, chosen or offered as a distractor: ${
        unused.length ? unused.map((u) => `\`${u}\``).join(", ") : "none"
      }`,
    );
    if (unused.length > 0) {
      push(
        "  - unused in every sense, so a reviewer may want to know whether these are future content or",
        "    leftovers from an earlier draft.",
      );
    }
    push("");
  }

  // -- C8 audit ----------------------------------------------------------------
  push("## Every wrong answer, and the misconception it represents", "");
  push(
    "docs/06 (C8) requires a wrong answer to name the real-world misconception it stands for, so the",
    "admin heatmap is a record of what trainees actually get wrong rather than a count of",
    "miss-clicks. Listed in one place so the mapping can be judged as a whole — are these the right",
    "misconceptions, and are any of them phrased in a way that would be unsafe to show a trainee?",
    "",
  );
  const misconceptionTable: string[] = [
    "| Module | Step | Wrong answer | Misconception |",
    "|---|---|---|---|",
  ];
  let misconceptionRows = 0;
  for (const code of MODULE_CODES) {
    for (const step of MODULES[code]!.steps) {
      for (const choice of step.choices ?? []) {
        if (choice.correct) continue;
        misconceptionRows += 1;
        misconceptionTable.push(
          `| ${code} | \`${step.id}\` | \`${choice.id}\` | ${cell(choice.misconception)} |`,
        );
      }
    }
  }
  if (misconceptionRows === 0) misconceptionTable.push("| — | — | — | — |");
  table(...misconceptionTable);
  push(
    "",
    `**${misconceptionRows} wrong answer(s) in the shipped content.**`,
  );

  // -- What the gate does ------------------------------------------------------
  push("## What the assessment does with a miss", "");
  push(
    "So the review can be judged against the consequence of a wrong answer, not just the wording of",
    "it. These are the existing contracts; the specs in [docs/14](./14-ASSESSMENT-CERTIFICATE-OFFLINE.md)",
    "are authoritative over the implementation.",
    "",
  );
  const gateRows: string[] = ["| Gate | Requirement | Current threshold |", "|---|---|---|"];
  for (const row of [
    ["G1", "Every module meets its pass score", "per module, 80"],
    ["G3", "No critical step missed on first attempt", "0"],
    ["G4", "No failure state that blocks certification", "0"],
    ["G5", "Overall first-attempt accuracy", "80%"],
    ["G6", "Mean hint dependency", "≤ 0.3"],
    ["G7", "Cold retention re-check", "80%, fail-closed if not taken"],
    ["G8", "Ordering integrity in every module", "no violations"],
  ] as const) {
    gateRows.push(`| ${row[0]} | ${row[1]} | ${row[2]} |`);
  }
  table(...gateRows);
  push(
    "",
    `Approved critical steps: ${APPROVED_CRITICAL_STEPS.map((s) => `\`${s}\``).join(", ")}.`,
  );

  // -- Sign-off ----------------------------------------------------------------
  push("## Recording the outcome", "");
  push(
    "A reviewer's decision belongs in the repository, not in this file:",
    "",
    "1. Correct the content in `src/modules/<MODULE>.json`.",
    "2. For a step that was blocked, remove `pendingSafetyReview` and delete its entry from",
    "   `PENDING_SAFETY_REVIEW` in `src/lib/validate-content.ts`.",
    "3. If a step must differ from the spec table, add or remove a `DECLARED_DEVIATIONS` entry in",
    "   `src/lib/spec-tables.ts` with its reason — the conformance test will otherwise fail.",
    "4. Run `bun run make:packet` and `bun test`.",
    "5. Open a pull request. The diff is the record of what changed and why.",
    "",
    "**What must not happen:** this file edited by hand, a step deleted rather than corrected, a",
    "review answered by adding a `misconception` string that does not name a real misconception, or",
    "safety wording machine-translated. `sat` is a reserved slot with no content and will stay that",
    "way until reviewed content exists.",
  );

  // Collapsed to at most one blank line between blocks, and exactly one trailing
  // newline, so that regenerating unchanged content produces a byte-identical
  // file and the freshness test does not fail on whitespace.
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
