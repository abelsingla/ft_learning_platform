# ADR-0007: Use a local SB3 recovery cache before remote draft persistence

- Status: Accepted
- Date: 2026-10-28

## Context

Scratch server autosave is available only for saveable account projects. A
learner working in a standalone editor, an LMS iframe, or an intermittently
connected classroom still needs protection against a reload or browser crash.
The learning service and its authenticated draft API are not implemented yet.

## Decision

Add a browser-local recovery layer that stores a complete SB3 artifact and the
exercise status map in IndexedDB. Debounced saves use a versioned record scoped
to an opaque learning attempt ID. The editor restores the matching record after
the base project loads and exposes save, restore, and error metadata events.

An LMS or the fischertechnik Learning Platform must provide a stable opaque
attempt scope on shared devices. The standalone fallback derives a scope from
the activity revision and Scratch project, and is for evaluation only.

Treat the local record as a disposable recovery cache. It is not a submission,
teacher-visible history, or source of authorization. The later remote adapter
will implement the same draft-store boundary with authenticated persistence,
optimistic concurrency, and idempotency.

## Consequences

- Unsigned and offline learners can recover complete programs, including assets.
- Exercise progress and program state are restored together.
- Draft metadata can be integrated without sending project content via browser messages.
- Browser eviction or shared-device cleanup can remove the cache.
- Immutable submission and teacher review remain separate workflows.
