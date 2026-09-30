# KAVACH — Assessment, Certificate & Offline Specification

## Assessment model

The existing scoring contract evaluates:
- first-attempt performance: 35%;
- order integrity: 15%;
- self-recovery: 15%;
- hint dependency: 10%;
- hesitation: 10%;
- completeness: 15%.

The score measures observable training behaviour, not attendance.

## Qualification gates

The existing gate contract is:
- G1 module score ≥80;
- G2 required modules completed;
- G3 zero critical first-attempt misses;
- G4 zero certificate-blocking failures;
- G5 overall first-attempt accuracy ≥80%;
- G6 mean hint dependency ≤0.3;
- G7 cold re-check ≥80%;
- G8 ordering integrity.

The implementation in the existing gate module remains authoritative.

## Cold re-check

After module completion, an eligible trainee receives a delayed re-check. Four steps are sampled, including the highest-weight critical step and a sample biased toward a weak area. This measures retention rather than immediate repetition.

## Telemetry

As applicable, each step records:
- outcome;
- attempt index;
- elapsed time;
- hint use;
- self-recovery;
- prompting;
- sequence position;
- order violation;
- offline state;
- timestamp.

Telemetry is step-level and renderer-independent.

## Offline

Offline operation must support loading required content, completing training, storing telemetry locally, queuing synchronization, safe retry, idempotent server ingestion, and reconciliation after reconnect.

## Certificate

Certificate issuance is allowed only after required gates, including cold re-check, pass.

QR verification must reject unknown/tampered data and expose certificate status. Revocation is authoritative when implemented.

## Acceptance tests

- Critical first-attempt failure blocks qualification.
- Clean run can satisfy required gates.
- Hint use changes hint-dependency evidence.
- Order violation is recorded.
- Offline completion survives restart and later synchronizes.
- Duplicate synchronization does not create duplicate authoritative attempts.
- Invalid QR data is rejected.
