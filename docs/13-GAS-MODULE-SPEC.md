# KAVACH — GAS Module Specification

**Module:** GAS v1  
**Status:** Draft training contract; safety approval pending

## Scenario objective

Train a miner to recognise a hazardous-gas or confined-space condition, avoid unsafe entry, raise the appropriate warning, follow the defined withdrawal/isolation procedure, and proceed through the mine emergency-response path.

## Six-step structure

| Seq | ID | Kind | Critical | Expected behaviour |
|---|---|---|---|---|
| 1 | G-01 | observe | No | Recognize the gas/confined-space warning condition |
| 2 | G-02 | decide | Yes | Select the safe immediate response |
| 3 | G-03 | act | Yes | Raise warning/communicate the emergency |
| 4 | G-04 | act | Yes | Withdraw or remain outside the defined hazardous area as instructed |
| 5 | G-05 | decide | Yes | Select the approved isolation/response action |
| 6 | G-06 | decide | No | Report/assemble according to the emergency procedure |

## Safety boundary

Exact gas types, detector thresholds, respiratory-protection rules, isolation procedures, confined-space controls, and re-entry conditions must come from approved mine procedures and qualified review.

The simulator must never imply that an untrained worker should enter a suspected hazardous atmosphere to investigate.

## Content requirements

Each wrong choice must map to a documented misconception. Critical unsafe actions block qualification on first attempt. Hindi/Santali wording requires appropriate language and safety review.

## Renderer contract

All six steps use semantic actions compatible with the 3D training environment, L2 AR, and L3 guided presentation.

## Review gate

**Release blocker:** qualified mining safety review of all procedures and language content.
