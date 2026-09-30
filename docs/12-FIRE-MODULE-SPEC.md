# KAVACH — FIRE Module Specification

**Module:** FIRE v1  
**Status:** Draft training contract; safety approval pending

## Scenario

A trainee encounters a defined fire emergency in a mine training environment and must recognise the condition, raise the alarm, select the appropriate firefighting equipment for the defined scenario, demonstrate the approved extinguisher procedure, withdraw according to the scenario's approved emergency procedure, and report to the designated assembly point.

## Learning outcomes

The trainee should demonstrate:
1. awareness of the nearest exit;
2. alarm/notification behaviour;
3. appropriate extinguisher selection for the defined fire scenario;
4. approved PASS sequence where an extinguisher is appropriate;
5. safe withdrawal behaviour;
6. assembly/accountability behaviour.

## Six-step structure

| Seq | ID | Kind | Critical | Expected behaviour |
|---|---|---|---|---|
| 1 | A-01 | observe | No | Identify nearest exit |
| 2 | A-02 | observe | No | Raise the fire alarm |
| 3 | A-03 | decide | Yes | Select the appropriate extinguisher for the defined fire scenario |
| 4 | A-04 | act | No | Execute the approved PASS sequence |
| 5 | A-05 | act | Yes | Follow the scenario-specific safe withdrawal procedure |
| 6 | A-06 | decide | No | Proceed to the designated assembly point and follow reporting instructions |

## Safety rules for authoring

The module must not encode an unconditional universal rule such as “always fight” or “always evacuate first.” Scenario conditions must determine whether the trainee is expected to raise the alarm, fight an incipient fire, withdraw, or seek assistance.

Extinguisher selection must be tied to the explicitly defined fire type and available equipment and reviewed against applicable Indian mine-safety requirements.

A-05 must describe the approved scenario procedure, not an invented universal “nearest first” ordering.

## Assessment

- A-03 and A-05 are critical.
- A critical first-attempt miss blocks qualification under the existing gate contract.
- Every wrong choice/action has a defined misconception or failure meaning.
- Hints support recovery but do not erase first-attempt evidence.

## Renderer requirements

Every target/action must be representable in the 3D training environment, L2 AR, and L3 guided fallback.

## Review gate

**Release blocker:** qualified mining safety review of extinguisher mapping, PASS instruction, alarm/withdrawal procedure, assembly/accountability wording, and Hindi/Santali safety language.

No claim that FIRE content is safety-validated may be made before that review.
