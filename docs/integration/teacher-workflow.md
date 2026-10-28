# Teacher integration workflow

## Scope

This contract prepares the fischertechnik Learning Platform to receive one
immutable Scratch submission per exercise and present it to an authorized
teacher. It does not make local autosave drafts visible to teachers.

## Editor boundary

The editor receives an opaque `learningAttemptId` and a
`learningSubmissionClient`. When a learner submits a completed exercise, the
client receives:

- a complete `.sb3` artifact as a `Blob`; and
- metadata conforming to `contracts/learning-submission-v1.schema.json`.

The platform must return a receipt conforming to
`contracts/learning-submission-receipt-v1.schema.json`. The client submission ID
is an idempotency key. Repeating the same failed request must return the same
submission record rather than create a duplicate.

The editor emits `ft-learning/submission-created.v1` or
`ft-learning/submission-error.v1` with metadata only. Project content is never
sent through browser events.

## Initial service API

The learning service should expose these authenticated operations:

| Operation | Purpose |
| --- | --- |
| `POST /v1/attempts/{attemptId}/submissions` | Store metadata and one SB3 file as an immutable submission. |
| `GET /v1/courses/{courseId}/activities/{activityId}/teacher-view` | Return the teacher read model. |
| `GET /v1/submissions/{submissionId}/artifact` | Return a short-lived authorized SB3 download. |
| `PUT /v1/submissions/{submissionId}/review` | Save score, rubric evidence, and teacher comment. |

The submission endpoint should use `multipart/form-data` with a `metadata` JSON
part and an `artifact` binary part. It must authorize the attempt from the
server session, verify the SHA-256 digest, enforce an SB3 size limit, scan the
archive, and persist the artifact before returning a receipt.

The teacher view response conforms to
`contracts/teacher-activity-view-v1.schema.json`. Artifact URLs must be
short-lived and generated only after checking the teacher's course membership.

## LTI Advantage mapping

- LTI 1.3 launch establishes the tenant, course, activity, user, and role.
- Deep Linking 2.0 lets a teacher select an activity and creates the associated
  gradebook line item.
- Names and Role Provisioning Services 2.0 supplies the authorized course
  roster used by the teacher view.
- Assignment and Grade Services 2.0 receives the reviewed score and optional
  comment. Detailed SB3 evidence remains in the learning platform.

The editor never receives LTI private keys, OAuth client credentials, reusable
administrator tokens, or the course roster.

## Privacy and audit requirements

- Resolve learner identity from the authenticated attempt on the server; do not
  trust a learner ID supplied by the browser.
- Keep every submitted artifact immutable. A resubmission creates a new attempt
  number and retains the previous version according to policy.
- Record the submission actor, review actor, timestamps, digest, tenant, course,
  activity revision, and retention policy in the audit log.
- Do not expose mutable draft history unless the activity explicitly enables it
  and learners are informed.
- Return only course-scoped data to teachers and use opaque identifiers outside
  the learning service.
