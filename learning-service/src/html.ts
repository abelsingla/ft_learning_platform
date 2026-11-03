import type {ActivityManifest} from './activity.js';
import type {ReviewData, SubmissionRecord} from './repository.js';

const escapeHtml = (value: string): string => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const submissionRow = (submission: SubmissionRecord): string => `<tr>
    <td>${escapeHtml(submission.exerciseId)}</td>
    <td>Version ${submission.attemptNumber}</td>
    <td>${escapeHtml(new Date(submission.submittedAt).toLocaleString('en'))}</td>
    <td><code>${escapeHtml(submission.sha256.slice(0, 12))}…</code></td>
    <td><a href="/v1/submissions/${encodeURIComponent(submission.submissionId)}/artifact">Download SB3</a></td>
</tr>`;

export const renderReviewPage = (manifest: ActivityManifest, data: ReviewData): string => {
    const sections = data.attempts.map(attempt => {
        const submissions = data.submissions.filter(submission => submission.attemptId === attempt.attemptId);
        const label = attempt.displayName || `Learner ${attempt.attemptId.slice(0, 8)}`;
        const body = submissions.length ? `<table>
            <thead><tr><th>Exercise</th><th>Submission</th><th>Submitted</th><th>SHA-256</th><th>Artifact</th></tr></thead>
            <tbody>${submissions.map(submissionRow).join('')}</tbody>
        </table>` : '<p>No submissions yet.</p>';
        return `<section><h2>${escapeHtml(label)}</h2>${body}</section>`;
    }).join('');

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(manifest.title)} — Teacher review</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#222}table{border-collapse:collapse;width:100%}th,td{text-align:left;border-bottom:1px solid #ddd;padding:.65rem}section{margin:2rem 0}code{font-size:.9em}</style>
</head><body><h1>${escapeHtml(manifest.title)} — Teacher review</h1>
<p>Activity revision ${escapeHtml(manifest.revision)}. Each row is an immutable submission version.</p>
${sections || '<p>No learner attempts have been launched for this course activity.</p>'}</body></html>`;
};
