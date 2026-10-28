# ADR-0002: Use LTI 1.3 Advantage as the LMS boundary

- Status: Accepted
- Date: 2026-10-28

## Context

The product may connect to customer-managed Moodle installations or to a Moodle
service operated for multiple schools. A Moodle-only plugin would make other LMS
integrations expensive and would mix product learning records with one LMS data
model.

## Decision

Implement the product as an LTI 1.3 tool and support the relevant LTI Advantage
services:

- Deep Linking for selecting product activities and content;
- Names and Role Provisioning Services for authorized course membership access;
- Assignment and Grade Services for gradebook synchronization.

Keep detailed evidence, project versions, and teacher review in the learning
platform. Return appropriate scores and summaries to the LMS.

## Consequences

- One integration can serve managed and customer-owned Moodle deployments.
- Other conforming LMS products can be added without changing the learning core.
- The service must manage platform registrations, key rotation, tenant mapping,
  launch validation, and LMS-specific conformance testing.
