# KAVACH — FROZEN BUILD SPECIFICATION

**Project:** AR-Based Mining Vocational Training Simulator  
**Problem:** SIH26041  
**Status:** Pre-implementation freeze candidate  
**Authority:** Single consolidated build contract.

## 1. Product

KAVACH is a phone-first mining vocational training simulator that teaches and assesses safety behaviour through interactive scenarios.

## 2. Required modules

- FIRE
- GAS

Both use the same generic training engine and assessment contract.

## 3. Presentation strategy

### Current renderer: 3D Training Environment

The 3D room is an intentional **development and training surface**. It is used to teach procedures, validate object placement and interaction, test wrong actions/recovery, test assessment and telemetry, and demonstrate the complete training flow before AR is production-ready.

It is not disposable scaffolding.

### L2 AR renderer

The AR renderer is the production presentation path. It replaces the presentation surface, not the training logic.

### L3 guided renderer

L3 provides a no-camera fallback with the same semantic steps, success/failure behaviour, assessment, and telemetry.

## 4. Frozen invariants

The following remain renderer-independent:
- module schema;
- step schema;
- success/failure rules;
- misconception mapping;
- scoring;
- qualification gates;
- telemetry;
- cold re-check;
- certificate eligibility;
- offline synchronization semantics.

## 5. Safety

Safety content is never invented to fill a UI. FIRE and GAS remain release-blocked until qualified review of safety-sensitive procedures. Official Indian mine-safety requirements are the baseline source where applicable.

## 6. Assessment

Existing scoring and gate implementations are authoritative unless an acceptance test exposes a defect.

## 7. Offline and certificate

Offline completion must survive disconnection and synchronize idempotently. Certificates are issued only after qualification, including cold retention re-check.

## 8. Language

Hindi is currently prepared. Santali is **not yet prepared** and is therefore not claimed as shipped. Santali remains a required target-language deliverable and must be completed/reviewed before full language compliance is claimed.

## 9. Explicitly deferred

- Photorealistic 3D.
- Full physics simulation.
- VR/headset.
- Multiplayer.
- AI-based safety adjudication.
- Additional modules before FIRE/GAS are complete.
- Unnecessary architecture refactors.
- Cosmetic work that does not improve training, safety, or acceptance.

## 10. Change control

After acceptance, changes require a documented reason: SIH requirement, safety correction, contract defect, or acceptance blocker. Otherwise the change belongs in the post-MVP backlog.

## 11. Required documentation

- `docs/09-SIH-REQUIREMENTS-TRACEABILITY.md`
- `docs/10-PRODUCT-MVP-SCOPE.md`
- `docs/11-FROZEN-ARCHITECTURE.md`
- `docs/12-FIRE-MODULE-SPEC.md`
- `docs/13-GAS-MODULE-SPEC.md`
- `docs/14-ASSESSMENT-CERTIFICATE-OFFLINE.md`
- `docs/15-BUILD-ACCEPTANCE-PLAN.md`

## 12. Implementation gate

No implementation work governed by this spec starts until the documentation is reconciled and accepted. After freeze, execute the build plan without reopening architecture for cosmetic or speculative improvements.
