import {createHash} from 'node:crypto';

import {activityManifest, exerciseIds, type ExerciseStatus} from './activity.js';
import {HttpError} from './errors.js';

export const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
const statuses = new Set<ExerciseStatus>(['available', 'in_progress', 'completed', 'locked']);

const objectValue = (value: unknown, field: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new HttpError(400, `${field} must be an object.`);
    }
    return value as Record<string, unknown>;
};

const exactKeys = (value: Record<string, unknown>, keys: string[], field: string): void => {
    const allowed = new Set(keys);
    if (Object.keys(value).some(key => !allowed.has(key))) {
        throw new HttpError(400, `${field} contains unsupported fields.`);
    }
};

const requiredString = (value: unknown, field: string, maxLength = 160): string => {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
        throw new HttpError(400, `${field} must be a non-empty string of at most ${maxLength} characters.`);
    }
    return value;
};

export const parseExerciseStatuses = (value: unknown): Record<string, ExerciseStatus> => {
    const candidate = objectValue(value, 'exerciseStatuses');
    const result: Record<string, ExerciseStatus> = {};
    for (const [exerciseId, status] of Object.entries(candidate)) {
        if (!exerciseIds.has(exerciseId) || typeof status !== 'string' || !statuses.has(status as ExerciseStatus)) {
            throw new HttpError(400, 'exerciseStatuses contains an unknown exercise or status.');
        }
        result[exerciseId] = status as ExerciseStatus;
    }
    return result;
};

export interface DraftMetadata {
    schemaVersion: 1;
    activityId: string;
    activityRevision: string;
    projectId: string | null;
    version: number;
    exerciseStatuses: Record<string, ExerciseStatus>;
}

export const parseDraftMetadata = (value: unknown): DraftMetadata => {
    const candidate = objectValue(value, 'draft metadata');
    exactKeys(candidate, [
        'schemaVersion', 'id', 'activityId', 'activityRevision', 'projectId', 'version', 'savedAt',
        'byteLength', 'exerciseStatuses'
    ], 'draft metadata');
    if (candidate.schemaVersion !== 1) throw new HttpError(400, 'Unsupported draft schema version.');
    if (candidate.activityId !== activityManifest.activityId ||
        candidate.activityRevision !== activityManifest.revision) {
        throw new HttpError(400, 'Draft activity or revision does not match this resource.');
    }
    if (!Number.isSafeInteger(candidate.version) || (candidate.version as number) < 1) {
        throw new HttpError(400, 'Draft version must be a positive integer.');
    }
    return {
        schemaVersion: 1,
        activityId: activityManifest.activityId,
        activityRevision: activityManifest.revision,
        projectId: candidate.projectId === null ? null : requiredString(candidate.projectId, 'projectId'),
        version: candidate.version as number,
        exerciseStatuses: parseExerciseStatuses(candidate.exerciseStatuses)
    };
};

export interface SubmissionMetadata {
    schemaVersion: 1;
    clientSubmissionId: string;
    attemptId: string;
    activityId: string;
    activityRevision: string;
    exerciseId: string;
    projectId: string | null;
    createdAt: string;
    artifact: {
        fileName: string;
        mediaType: 'application/x.scratch.sb3';
        byteLength: number;
        sha256: string;
    };
    evidence: {exerciseStatuses: Record<string, ExerciseStatus>};
}

export const parseSubmissionMetadata = (value: unknown): SubmissionMetadata => {
    const candidate = objectValue(value, 'submission metadata');
    exactKeys(candidate, [
        'schemaVersion', 'clientSubmissionId', 'attemptId', 'activityId', 'activityRevision', 'exerciseId',
        'projectId', 'createdAt', 'artifact', 'evidence'
    ], 'submission metadata');
    if (candidate.schemaVersion !== 1) throw new HttpError(400, 'Unsupported submission schema version.');
    if (candidate.activityId !== activityManifest.activityId ||
        candidate.activityRevision !== activityManifest.revision) {
        throw new HttpError(400, 'Submission activity or revision does not match this resource.');
    }
    const exerciseId = requiredString(candidate.exerciseId, 'exerciseId', 80);
    if (!exerciseIds.has(exerciseId)) throw new HttpError(400, 'Unknown exerciseId.');
    const createdAt = requiredString(candidate.createdAt, 'createdAt');
    if (Number.isNaN(Date.parse(createdAt))) throw new HttpError(400, 'createdAt must be an ISO timestamp.');

    const artifact = objectValue(candidate.artifact, 'artifact');
    exactKeys(artifact, ['fileName', 'mediaType', 'byteLength', 'sha256'], 'artifact');
    const fileName = requiredString(artifact.fileName, 'artifact.fileName', 170);
    if (!/^[A-Za-z0-9._-]+\.sb3$/.test(fileName)) throw new HttpError(400, 'Invalid SB3 file name.');
    if (artifact.mediaType !== 'application/x.scratch.sb3') throw new HttpError(400, 'Invalid artifact media type.');
    if (!Number.isSafeInteger(artifact.byteLength) || (artifact.byteLength as number) < 1 ||
        (artifact.byteLength as number) > MAX_ARTIFACT_BYTES) {
        throw new HttpError(400, 'Invalid artifact byte length.');
    }
    if (typeof artifact.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
        throw new HttpError(400, 'Invalid artifact SHA-256 digest.');
    }
    const evidence = objectValue(candidate.evidence, 'evidence');
    exactKeys(evidence, ['exerciseStatuses'], 'evidence');
    const exerciseStatuses = parseExerciseStatuses(evidence.exerciseStatuses);
    if (exerciseStatuses[exerciseId] !== 'completed') {
        throw new HttpError(409, 'The exercise must be completed before it can be submitted.');
    }

    return {
        schemaVersion: 1,
        clientSubmissionId: requiredString(candidate.clientSubmissionId, 'clientSubmissionId'),
        attemptId: requiredString(candidate.attemptId, 'attemptId'),
        activityId: activityManifest.activityId,
        activityRevision: activityManifest.revision,
        exerciseId,
        projectId: candidate.projectId === null ? null : requiredString(candidate.projectId, 'projectId'),
        createdAt,
        artifact: {
            fileName,
            mediaType: 'application/x.scratch.sb3',
            byteLength: artifact.byteLength as number,
            sha256: artifact.sha256
        },
        evidence: {exerciseStatuses}
    };
};

export const parseJsonBuffer = (buffer: Buffer, field: string): unknown => {
    try {
        return JSON.parse(buffer.toString('utf8')) as unknown;
    } catch {
        throw new HttpError(400, `${field} must contain valid JSON.`);
    }
};

export const sha256 = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');

export const validateSb3 = (artifact: Buffer): void => {
    if (artifact.length < 4 || artifact.length > MAX_ARTIFACT_BYTES || artifact[0] !== 0x50 || artifact[1] !== 0x4b) {
        throw new HttpError(400, 'Artifact must be a non-empty SB3 ZIP file within the size limit.');
    }
};
