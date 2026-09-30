# KAVACH — SIH Requirements & Traceability

**Project:** AR-Based Mining Vocational Training Simulator (KAVACH)  
**Problem:** SIH26041  
**Status:** Documentation baseline — pre-code freeze

## 1. Requirement baseline

| Requirement | KAVACH response | Acceptance evidence |
|---|---|---|
| Android 10+ | Android-compatible phone/PWA delivery path | Install/run test on Android 10+ |
| No external headset | Phone-first interaction | Complete module on ordinary Android phone |
| AR-based training | L2 reticle AR presentation | Camera/reticle scenario completes |
| Fire & Explosion module | FIRE module | Six-step scenario and assessment pass |
| Gas Leak & Confined Space | GAS module | Six-step scenario and assessment pass |
| Assessment of comprehension | First-attempt behavioural assessment | Deliberate errors produce correct outcomes |
| QR certificate | Certificate issue + verification | Valid and invalid QR tests |
| Hindi + Santali | Localised content contract; Hindi currently available; Santali pending prepared/reviewed content | Language completeness test before full compliance claim |
| Offline operation | Local persistence and sync queue | Airplane-mode training and later sync |
| Web/admin compliance view | Admin dashboard/compliance evidence | Attempt records visible |
| Public GitHub repository | Source and documentation | Repository review |

## 2. 3D training environment

The 3D environment is a deliberate **current development and training renderer**. It is used to teach procedures, validate interaction and object placement, test wrong actions/recovery, and validate the complete training flow before AR presentation is production-ready.

The 3D renderer consumes the same training contract as future AR/guided renderers. It must not own scoring, qualification, certification, or safety rules.

## 3. Traceability rule

Every mandatory requirement must have documented product behaviour, implementation boundary, acceptance test, and demo evidence where applicable.

A feature is not added merely because it is technically interesting. It must be justified by SIH scope, safety, training validity, architecture, or acceptance evidence.
