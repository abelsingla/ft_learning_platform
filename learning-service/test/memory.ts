import {randomUUID} from 'node:crypto';

import type {
    AccessTokenRecord,
    DatabaseManager,
    IdTokenClaims,
    IdTokenRecord,
    PlatformAttributes,
    PlatformFilter,
    PlatformRecord
} from 'ltijs';

import {
    StorageConflictError,
    type Attempt,
    type CreateSubmissionInput,
    type DraftRecord,
    type LaunchScope,
    type LearningRepository,
    type ReviewData,
    type SaveDraftInput,
    type Session,
    type SubmissionRecord
} from '../src/repository.js';

const matchScope = (record: LaunchScope, scope: LaunchScope): boolean =>
    record.platformId === scope.platformId &&
    record.deploymentId === scope.deploymentId &&
    record.courseId === scope.courseId &&
    record.resourceLinkId === scope.resourceLinkId;

export class MemoryLtiDatabase implements DatabaseManager {
    platforms: PlatformRecord[] = [];
    idTokens = new Map<string, IdTokenRecord>();
    nonces = new Set<string>();
    accessTokens = new Map<string, AccessTokenRecord>();

    async listen (): Promise<void> {}
    async close (): Promise<void> {}

    async getPlatforms (filter: PlatformFilter = {}): Promise<PlatformRecord[]> {
        return this.platforms.filter(platform => {
            if (filter.url && platform.url !== filter.url) return false;
            if (filter.name && platform.name !== filter.name) return false;
            if (filter.clientId) {
                const values = Array.isArray(filter.clientId) ? filter.clientId : [filter.clientId];
                if (!values.includes(platform.clientId)) return false;
            }
            return true;
        });
    }

    async getPlatformById (id: string): Promise<PlatformRecord | undefined> {
        return this.platforms.find(platform => platform.id === id);
    }

    async getPlatformByUrlAndClientId (url: string, clientId: string): Promise<PlatformRecord | undefined> {
        return this.platforms.find(platform => platform.url === url && platform.clientId === clientId);
    }

    async savePlatform (platform: PlatformAttributes): Promise<string> {
        const id = randomUUID();
        this.platforms.push({...platform, id});
        return id;
    }

    async updatePlatformById (id: string, fields: Partial<PlatformAttributes>): Promise<void> {
        const index = this.platforms.findIndex(platform => platform.id === id);
        if (index < 0) return;
        this.platforms[index] = {...this.platforms[index]!, ...fields};
    }

    async deletePlatformById (id: string): Promise<void> {
        this.platforms = this.platforms.filter(platform => platform.id !== id);
    }

    async getAccessToken (platformUrl: string, clientId: string, scopes: string): Promise<AccessTokenRecord | undefined> {
        return this.accessTokens.get(`${platformUrl}:${clientId}:${scopes}`);
    }

    async saveAccessToken (
        platformUrl: string,
        clientId: string,
        scopes: string,
        token: AccessTokenRecord
    ): Promise<string> {
        const key = `${platformUrl}:${clientId}:${scopes}`;
        this.accessTokens.set(key, token);
        return key;
    }

    async getIdToken (id: string): Promise<IdTokenRecord | undefined> {
        return this.idTokens.get(id);
    }

    async saveIdToken (token: IdTokenClaims): Promise<string> {
        const id = randomUUID();
        this.idTokens.set(id, {...token, id});
        return id;
    }

    async saveNonce (nonce: string): Promise<string> {
        this.nonces.add(nonce);
        return nonce;
    }

    async consumeNonce (nonce: string): Promise<boolean> {
        if (!this.nonces.has(nonce)) return false;
        this.nonces.delete(nonce);
        return true;
    }
}

export class MemoryLearningRepository implements LearningRepository {
    attempts = new Map<string, Attempt>();
    sessions = new Map<string, Session>();
    drafts = new Map<string, {record: DraftRecord; artifact: Buffer}>();
    draftWrites = new Map<string, {digest: string; version: number}>();
    submissions = new Map<string, {record: SubmissionRecord; artifact: Buffer}>();

    async initialize (): Promise<void> {}
    async close (): Promise<void> {}

    async findOrCreateAttempt (
        scope: LaunchScope,
        subjectHash: string,
        displayName: string | null
    ): Promise<Attempt> {
        const existing = [...this.attempts.values()].find(attempt =>
            matchScope(attempt, scope) && attempt.subjectHash === subjectHash);
        if (existing) {
            existing.displayName = displayName;
            existing.lastActivityAt = new Date();
            return existing;
        }
        const now = new Date();
        const attempt: Attempt = {
            ...scope,
            attemptId: randomUUID(),
            subjectHash,
            displayName,
            activityId: 'hand-sensing-foundations',
            activityRevision: '1',
            createdAt: now,
            lastActivityAt: now
        };
        this.attempts.set(attempt.attemptId, attempt);
        return attempt;
    }

    async getAttempt (attemptId: string): Promise<Attempt | null> {
        return this.attempts.get(attemptId) ?? null;
    }

    async createSession (session: Session): Promise<void> {
        this.sessions.set(session.tokenHash, session);
    }

    async getSession (tokenHash: string): Promise<Session | null> {
        const session = this.sessions.get(tokenHash);
        return session && session.expiresAt > new Date() ? session : null;
    }

    async getDraft (attemptId: string): Promise<{record: DraftRecord; artifact: Buffer} | null> {
        return this.drafts.get(attemptId) ?? null;
    }

    async saveDraft (input: SaveDraftInput): Promise<DraftRecord> {
        const writeKey = `${input.attemptId}:${input.idempotencyKey}`;
        const previousWrite = this.draftWrites.get(writeKey);
        if (previousWrite) {
            if (previousWrite.digest !== input.artifactSha256 || previousWrite.version !== input.version) {
                throw new StorageConflictError('Draft idempotency conflict.');
            }
            return this.drafts.get(input.attemptId)!.record;
        }
        const current = this.drafts.get(input.attemptId);
        if ((current?.record.version ?? 0) !== input.expectedVersion || input.version !== input.expectedVersion + 1) {
            throw new StorageConflictError('Draft version conflict.');
        }
        const record: DraftRecord = {
            attemptId: input.attemptId,
            version: input.version,
            savedAt: new Date().toISOString(),
            byteLength: input.artifact.length,
            activityId: input.activityId,
            activityRevision: input.activityRevision,
            projectId: input.projectId,
            exerciseStatuses: input.exerciseStatuses,
            artifactPath: `memory:${input.attemptId}`
        };
        this.drafts.set(input.attemptId, {record, artifact: Buffer.from(input.artifact)});
        this.draftWrites.set(writeKey, {digest: input.artifactSha256, version: input.version});
        return record;
    }

    async deleteDraft (attemptId: string): Promise<void> {
        this.drafts.delete(attemptId);
    }

    async createSubmission (input: CreateSubmissionInput): Promise<SubmissionRecord> {
        const previous = [...this.submissions.values()].find(value =>
            value.record.attemptId === input.attemptId &&
            value.record.clientSubmissionId === input.clientSubmissionId);
        if (previous) {
            if (previous.record.sha256 !== input.sha256 || previous.record.exerciseId !== input.exerciseId) {
                throw new StorageConflictError('Submission idempotency conflict.');
            }
            return previous.record;
        }
        const attemptNumber = [...this.submissions.values()].filter(value =>
            value.record.attemptId === input.attemptId && value.record.exerciseId === input.exerciseId).length + 1;
        const submissionId = randomUUID();
        const record: SubmissionRecord = {
            platformId: input.platformId,
            deploymentId: input.deploymentId,
            courseId: input.courseId,
            resourceLinkId: input.resourceLinkId,
            submissionId,
            attemptId: input.attemptId,
            clientSubmissionId: input.clientSubmissionId,
            exerciseId: input.exerciseId,
            attemptNumber,
            submittedAt: new Date().toISOString(),
            activityId: input.activityId,
            activityRevision: input.activityRevision,
            projectId: input.projectId,
            fileName: input.fileName,
            mediaType: input.mediaType,
            byteLength: input.byteLength,
            sha256: input.sha256,
            exerciseStatuses: input.exerciseStatuses,
            artifactPath: `memory:${submissionId}`
        };
        this.submissions.set(submissionId, {record, artifact: Buffer.from(input.artifact)});
        return record;
    }

    async getSubmission (submissionId: string): Promise<SubmissionRecord | null> {
        return this.submissions.get(submissionId)?.record ?? null;
    }

    async readArtifact (record: SubmissionRecord): Promise<Buffer> {
        return this.submissions.get(record.submissionId)!.artifact;
    }

    async listReview (scope: LaunchScope): Promise<ReviewData> {
        return {
            attempts: [...this.attempts.values()].filter(attempt => matchScope(attempt, scope)),
            submissions: [...this.submissions.values()]
                .map(value => value.record)
                .filter(submission => matchScope(submission, scope))
        };
    }
}
