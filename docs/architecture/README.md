# Architecture baseline

## Product principles

1. **Standards before vendor coupling.** LMS integration targets LTI 1.3
   Advantage. Moodle is the first supported platform, not a hard dependency of
   the learning domain.
2. **Local-first computer vision.** Camera data is processed on the learner's
   device. The server receives only explicit learning events and submitted
   artifacts.
3. **Clear source boundaries.** The public AGPL editor fork is isolated from the
   learning service and its deployment lifecycle.
4. **Domain-neutral learning records.** Activities and evidence support robotics
   first, while their schemas remain suitable for mechanics, energy, and other
   product lines.
5. **Portable program representation.** Controller support and code generation
   depend on versioned contracts rather than editor internals.
6. **Child safety by default.** Data minimization, short retention defaults,
   tenant isolation, and explicit teacher controls are architectural constraints.

## Logical components

| Component | Responsibility | Initial deployment |
| --- | --- | --- |
| Editor fork | Visual programming, project editing, hand/gesture blocks | Browser |
| Vision worker | Local hand landmarks and gesture classification | Browser worker |
| Learning client | Activity context, autosave, submission, progress events | Browser |
| Learning service | Activities, attempts, artifacts, evidence, tenancy | EU-hosted service |
| LTI gateway | Launch, deep linking, roster, and grade exchange | Learning service |
| Artifact store | Versioned `.sb3` files and later generated code | EU object storage |
| Teacher application | Review, feedback, rubrics, and progress | Browser |
| Code-generation service | Portable IR validation and target generation | Future milestone |
| Device adapter | Controller-specific transport and API mapping | Future milestone |

## Trust boundaries

- Camera frames remain inside the editor origin and vision worker.
- The editor never receives reusable LMS administrator credentials.
- LTI tokens terminate at the server-side LTI gateway.
- Every learning record is scoped by tenant, course context, activity, and user.
- Submitted artifacts are immutable; later resubmissions create new versions.

## Initial integration flow

1. An LMS launches an activity through LTI 1.3.
2. The LTI gateway validates the launch and creates a short-lived editor session.
3. The learning client loads the assigned starter project and activity policy.
4. Drafts are autosaved with optimistic concurrency and are visible only to the
   learner unless the activity explicitly enables progress review.
5. A learner submits a selected draft version.
6. The service stores an immutable artifact, evidence summary, and audit event.
7. The teacher reviews the submission in the teacher application.
8. A score and optional comment are returned through LTI Assignment and Grade
   Services.

## Decision records

- [ADR-0001: Separate the editor fork from the learning platform](decisions/0001-separate-editor-and-learning-platform.md)
- [ADR-0002: Use LTI 1.3 Advantage as the LMS boundary](decisions/0002-lti-advantage-boundary.md)
- [ADR-0003: Perform hand inference exclusively on device](decisions/0003-local-hand-inference.md)
- [ADR-0004: Separate mutable drafts from immutable submissions](decisions/0004-drafts-and-submissions.md)
- [ADR-0005: Introduce a portable intermediate representation](decisions/0005-portable-program-ir.md)
- [ADR-0006: Deliver learning materials through a versioned editor manifest](decisions/0006-learning-material-manifest.md)
- [ADR-0007: Use a local SB3 recovery cache before remote draft persistence](decisions/0007-local-draft-recovery.md)
