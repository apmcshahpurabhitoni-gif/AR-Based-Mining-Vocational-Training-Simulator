# KAVACH — Build & Acceptance Plan

**Status:** Execution plan after documentation freeze

## Phase 0 — Documentation freeze

1. Reconcile supporting documents with the master specification.
2. Confirm Santali is marked pending, not falsely complete.
3. Confirm 3D is retained as the current training/development renderer.
4. Confirm FIRE safety-sensitive content remains review-gated.
5. Freeze the master specification.

## Phase 1 — FIRE end-to-end

1. Qualified safety review.
2. Finalize FIRE manifest from the approved scenario.
3. Complete the six FIRE steps in the 3D training environment.
4. Validate wrong actions, hints, recovery, ordering, and first-attempt evidence.
5. Run module/runner/scoring/gate tests.
6. Add tests only where an acceptance gap exists.

## Phase 2 — Renderer contract

Verify that 3D, L2 AR, and L3 guided surfaces dispatch equivalent semantic actions and cannot modify scoring or qualification decisions.

## Phase 3 — L2 AR

Implement/finish reticle AR against the frozen Step contract. Camera failure/denial routes to L3.

## Phase 4 — GAS

Safety review, final six-step manifest, 3D completion, and assessment validation.

## Phase 5 — Qualification platform

Offline queue/sync, cold re-check, certificate/QR verification, and admin/compliance dashboard.

## Phase 6 — Language release

Release Hindi with reviewed content. Complete Santali content and review before claiming full target language compliance.

## Definition of Done

MVP is done when FIRE and GAS work end-to-end; 3D training is deterministic; L2/L3 use the same contract; wrong actions and recovery are assessed; gates and cold re-check work; offline sync works; certificate verification works; required language content is prepared/reviewed; and SIH traceability has evidence.

## Stop rule

Once acceptance criteria pass, do not continue architectural polishing. Additional ideas become a post-MVP backlog.
