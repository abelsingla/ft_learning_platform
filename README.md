# fischertechnik Learning Platform

This workspace contains the product-level architecture and, later, the learning
services that integrate the visual programming editor with learning management
systems.

The customized Scratch editor is maintained as a separate public AGPL-3.0 fork
of `scratchfoundation/scratch-editor`. Keeping the editor and learning platform
separate makes upstream synchronization practical and lets the learning domain
support robotics, mechanics, renewable energy, and future product families.

## Current scope

The first prototype focuses on robotics and establishes these boundaries:

- a Scratch-compatible editor with an on-device hand and gesture extension;
- an LMS-neutral learning service exposed through LTI 1.3 Advantage;
- private autosave drafts and immutable student submissions;
- versioned project artifacts and teacher-facing evidence;
- a future code-generation boundary for Python, MicroPython, and controllers.

No camera frame, image, or video may leave the learner's device. Models, WASM
artifacts, and runtime assets must be served from an approved first-party origin.

## Repository layout

- `contracts/`: versioned submission and teacher-view JSON Schemas.
- `docs/architecture/`: system architecture and decision records.
- `docs/integration/`: editor, teacher, and LMS integration workflows.
- `scratch-editor/`: local clone of the public editor fork (created separately).
- Application and service packages will be added after the architecture baseline
  is reviewed.

## Licensing

The editor fork follows the upstream AGPL-3.0 license. Licensing for original
learning-platform services will be decided separately before product code is
published. Third-party software and model artifacts require a pinned inventory
and reproducible license review.
