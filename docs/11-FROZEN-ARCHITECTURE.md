# KAVACH — Frozen Architecture

**Status:** Architecture candidate for freeze  
**Principle:** One training contract, replaceable presentation surfaces.

## 1. Layers

### A. Module data

FIRE/GAS manifests contain ordered steps, localisation, targets, actions, choices, success/failure, hints, and assessment metadata.

### B. Generic training engine

The runner controls progression, valid actions, mistakes, hints, failure/recovery, and attempt state.

No FIRE/GAS-specific branching belongs in the generic runner.

### C. Presentation renderers

**3D Training Environment — current primary development/training surface**
- Teaches procedures.
- Allows complete flow testing before AR is ready.
- Provides deterministic target placement and interaction.
- Dispatches the same semantic actions as other renderers.
- Never calculates qualification or certificate decisions.

**L2 AR Renderer — production presentation path**
- Camera plus reticle/target overlays.
- Uses the same step/action contract.
- Camera data remains on-device.

**L3 Guided Renderer — fallback**
- No-camera guided/reference presentation.
- Same semantic actions and assessment.

### D. Assessment

Existing scoring/gate contracts remain authoritative:
- first-attempt accuracy;
- ordering;
- self-recovery;
- hint dependency;
- hesitation;
- completeness;
- G1–G8;
- cold re-check.

### E. Persistence/sync

Local attempt data is persisted offline and synchronized when connectivity returns. Server-side records are authoritative for qualification/certificate state.

### F. Certificate

Certificate issuance follows qualification gates and cold re-check. QR verification validates authenticity/status.

## 2. Dependency rule

**Presentation → semantic action → runner → assessment → persistence**

Never:
- presentation → scoring;
- presentation → certificate;
- presentation → safety decision.

## 3. Renderer replacement contract

A renderer may be replaced without changing:
- module schema;
- Step contract;
- success/failure rules;
- scoring;
- qualification gates;
- telemetry;
- certificate logic;
- offline synchronization semantics.

## 4. Implementation boundary

Do not redesign existing validated backend, scoring, gate, persistence, or module contracts unless an acceptance test demonstrates a defect.

## 5. Security/privacy boundary

- Camera frames remain on-device.
- No unnecessary camera-frame storage.
- No secrets in client code.
- Offline synchronization is idempotent.
