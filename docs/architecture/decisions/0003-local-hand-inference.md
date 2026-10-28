# ADR-0003: Perform hand inference exclusively on device

- Status: Accepted
- Date: 2026-10-28

## Context

Learners are expected to include children. The first editor extension recognizes
hands and static gestures. Sending classroom camera data to a server would add
privacy, safeguarding, latency, and operational risks.

## Decision

Run landmark detection and gesture classification in a dedicated browser worker.
Self-host pinned runtime, WASM, and model artifacts from an approved first-party
origin. Do not upload, log, persist, or include camera frames in telemetry.

The prototype uses `@tensorflow-models/hand-pose-detection` 2.0.1 and the
TensorFlow.js WASM backend 4.22.0, both under Apache-2.0. It uses the official
MediaPipe Hand Tracking lite models, also Apache-2.0, downloaded and pinned with
SHA-256 checksums. MediaPipe Tasks is not used because its current privacy notice
describes outbound usage metrics, which conflicts with the no-network boundary.

The extension boundary exposes normalized landmarks and derived gesture events,
not media streams. The first prototype supports up to two hands, 21 landmarks per
hand, and a stable set of static gestures. Temporal and custom gestures remain
future providers behind the same interface.

Enforce the boundary with Content Security Policy, network tests, dependency
pinning, integrity metadata, and a third-party notice inventory.

## Consequences

- Camera permission and computation remain local to the learner's browser.
- Classroom devices require a measured performance and browser support matrix.
- Model and runtime upgrades require privacy, license, accuracy, and performance
  review before release.
- Learning events may contain a gesture label and confidence only when required
  by an activity; they never contain raw frames.
