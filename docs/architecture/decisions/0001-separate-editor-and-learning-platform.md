# ADR-0001: Separate the editor fork from the learning platform

- Status: Accepted
- Date: 2026-10-28

## Context

The current Scratch editor is licensed under AGPL-3.0 and is maintained as a
large upstream monorepo. The product also needs learning content, tenant data,
LMS integration, teacher workflows, and artifact storage that are not editor
responsibilities.

## Decision

Maintain two source boundaries:

1. a public `abelsingla/scratch-editor` fork for editor and VM changes; and
2. a separate fischertechnik Learning Platform repository for learning services,
   contracts, applications, and deployment configuration.

Use versioned HTTP/event contracts between the editor and learning service. Do
not import LMS or persistence concerns into Scratch VM primitives.

## Consequences

- Upstream editor changes can be merged with less product-specific conflict.
- Editor license obligations and third-party notices remain visible.
- The learning platform can support non-programming product families.
- Cross-repository contracts require explicit compatibility tests and releases.
