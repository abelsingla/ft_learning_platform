# ADR-0006: Deliver learning materials through a versioned editor manifest

- Status: Accepted
- Date: 2026-10-28

## Context

Learners need teacher-authored instructions inside the editor while working on
an activity. The content may originate from the fischertechnik Learning Platform,
customer-managed Moodle, or another LTI-conforming LMS. Embedding Moodle-specific
markup or identifiers in Scratch projects would couple project portability to one
platform and mix learning state with program state.

## Decision

Deliver editor learning materials as a versioned, platform-neutral manifest. The
initial contract contains an activity ID, revision, display metadata, and ordered
exercise cards with stable IDs, instructions, difficulty, duration, and status.

Keep the manifest and exercise progress outside `.sb3` files. The editor accepts
an initial manifest property and an origin-checked `postMessage` bridge. Cross-origin
parents must be explicitly configured. Content is length-limited and rendered as
plain text.

Exercise status changes are explicit learner actions. The editor can notify the
configured host about those changes, but the learning service remains responsible
for attempt identity, authorization, persistence, audit, and submission semantics.

## Consequences

- The same editor UI can support managed Moodle, customer Moodle, and future LMSs.
- Scratch projects remain portable and contain only program content.
- Teacher-authored content can evolve independently through manifest revisions.
- A status event is progress evidence, not an immutable submission or grade.
