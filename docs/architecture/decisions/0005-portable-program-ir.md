# ADR-0005: Introduce a portable intermediate representation

- Status: Accepted
- Date: 2026-10-28

## Context

Scratch programs may contain sprites, clones, graphics, audio, concurrency, and
dynamic behavior that cannot be translated faithfully to a microcontroller.
Controller APIs are not yet available and will vary by product.

## Decision

Do not generate controller code directly from editor UI structures. Introduce a
versioned portable intermediate representation when code generation begins.

The pipeline will be:

`Scratch project -> validated portable IR -> target capability check -> code generator -> device adapter`

Maintain separate target profiles for host Python, MicroPython, and each future
controller family. Unsupported behavior produces explicit diagnostics tied to
source blocks; it is never silently omitted.

## Consequences

- Controller work can begin after its API is supplied without redesigning the
  editor or LMS integration.
- A defined portable subset is required for each target.
- Source maps and golden tests are necessary to connect generated diagnostics to
  visual blocks and to verify deterministic output.
