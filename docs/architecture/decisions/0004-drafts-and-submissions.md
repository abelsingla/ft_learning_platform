# ADR-0004: Separate mutable drafts from immutable submissions

- Status: Accepted
- Date: 2026-10-28

## Context

Learners need reliable autosave, while teachers need an auditable representation
of what was submitted for a task. Treating every autosave as a submission creates
noise and weakens assessment integrity.

## Decision

Store mutable draft heads backed by versioned artifacts. Autosave uses optimistic
concurrency and idempotency keys. A submission references one exact draft version
and creates an immutable record containing:

- tenant, course, activity, attempt, and learner identifiers;
- activity and starter-project versions;
- artifact digest and storage reference;
- editor and extension versions;
- submission timestamp and audit actor;
- derived evidence explicitly enabled by the activity policy.

Teacher access to draft history is disabled by default and can be enabled per
activity with clear learner-facing disclosure. Submitted versions are always
available according to the institution's retention policy.

## Consequences

- Autosave remains frequent without polluting teacher workflows.
- Teachers can reproduce the exact submitted program.
- Retention, deletion, export, and legal-hold behavior must distinguish drafts,
  submissions, and derived learning events.
