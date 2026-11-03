import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {MongoClient, type Collection, type WithId} from 'mongodb';

import type {ExerciseStatus} from './activity.js';

export interface LaunchScope {
    platformId: string;
    deploymentId: string;
    courseId: string;
    resourceLinkId: string;
}

export interface Attempt extends LaunchScope {
    attemptId: string;
    subjectHash: string;
    displayName: string | null;
    activityId: string;
    activityRevision: string;
    createdAt: Date;
    lastActivityAt: Date;
}

export interface Session extends LaunchScope {
    tokenHash: string;
    role: 'learner' | 'teacher';
    attemptId: string | null;
    expiresAt: Date;
}

export interface DraftRecord {
    attemptId: string;
    version: number;
    savedAt: string;
    byteLength: number;
    activityId: string;
    activityRevision: string;
    projectId: string | null;
    exerciseStatuses: Record<string, ExerciseStatus>;
    artifactPath: string;
}

export interface SaveDraftInput extends Omit<DraftRecord, 'artifactPath' | 'byteLength' | 'savedAt'> {
    expectedVersion: number;
    idempotencyKey: string;
    artifact: Buffer;
    artifactSha256: string;
}

export interface SubmissionRecord extends LaunchScope {
    submissionId: string;
    attemptId: string;
    clientSubmissionId: string;
    exerciseId: string;
    attemptNumber: number;
    submittedAt: string;
    activityId: string;
    activityRevision: string;
    projectId: string | null;
    fileName: string;
    mediaType: 'application/x.scratch.sb3';
    byteLength: number;
    sha256: string;
    exerciseStatuses: Record<string, ExerciseStatus>;
    artifactPath: string;
}

export interface CreateSubmissionInput extends Omit<SubmissionRecord,
    'submissionId' | 'attemptNumber' | 'submittedAt' | 'artifactPath'> {
    artifact: Buffer;
}

export interface ReviewData {
    attempts: Attempt[];
    submissions: SubmissionRecord[];
}

export class StorageConflictError extends Error {}

export interface LearningRepository {
    initialize(): Promise<void>;
    close(): Promise<void>;
    findOrCreateAttempt(scope: LaunchScope, subjectHash: string, displayName: string | null): Promise<Attempt>;
    getAttempt(attemptId: string): Promise<Attempt | null>;
    createSession(session: Session): Promise<void>;
    getSession(tokenHash: string): Promise<Session | null>;
    getDraft(attemptId: string): Promise<{record: DraftRecord; artifact: Buffer} | null>;
    saveDraft(input: SaveDraftInput): Promise<DraftRecord>;
    deleteDraft(attemptId: string): Promise<void>;
    createSubmission(input: CreateSubmissionInput): Promise<SubmissionRecord>;
    getSubmission(submissionId: string): Promise<SubmissionRecord | null>;
    readArtifact(record: SubmissionRecord): Promise<Buffer>;
    listReview(scope: LaunchScope): Promise<ReviewData>;
}

interface DraftWriteRecord {
    attemptId: string;
    idempotencyKey: string;
    artifactSha256: string;
    version: number;
}

const withoutMongoId = <T extends object>(value: WithId<T>): T => {
    const {_id: _id, ...record} = value;
    void _id;
    return record as T;
};

const digestPathPart = (value: string): string => createHash('sha256').update(value).digest('hex');

export class MongoLearningRepository implements LearningRepository {
    private readonly client: MongoClient;
    private readonly dataDir: string;
    private readonly attempts: Collection<Attempt>;
    private readonly sessions: Collection<Session>;
    private readonly drafts: Collection<DraftRecord>;
    private readonly draftWrites: Collection<DraftWriteRecord>;
    private readonly submissions: Collection<SubmissionRecord>;
    private readonly locks = new Map<string, Promise<void>>();

    constructor (mongoUrl: string, dataDir: string) {
        this.client = new MongoClient(mongoUrl);
        this.dataDir = dataDir;
        const database = this.client.db();
        this.attempts = database.collection<Attempt>('learning_attempts');
        this.sessions = database.collection<Session>('learning_sessions');
        this.drafts = database.collection<DraftRecord>('learning_drafts');
        this.draftWrites = database.collection<DraftWriteRecord>('learning_draft_writes');
        this.submissions = database.collection<SubmissionRecord>('learning_submissions');
    }

    async initialize (): Promise<void> {
        await this.client.connect();
        await mkdir(join(this.dataDir, 'drafts'), {recursive: true});
        await mkdir(join(this.dataDir, 'submissions'), {recursive: true});
        await Promise.all([
            this.attempts.createIndex(
                {platformId: 1, deploymentId: 1, courseId: 1, resourceLinkId: 1, subjectHash: 1},
                {unique: true}
            ),
            this.attempts.createIndex({attemptId: 1}, {unique: true}),
            this.sessions.createIndex({tokenHash: 1}, {unique: true}),
            this.sessions.createIndex({expiresAt: 1}, {expireAfterSeconds: 0}),
            this.drafts.createIndex({attemptId: 1}, {unique: true}),
            this.draftWrites.createIndex({attemptId: 1, idempotencyKey: 1}, {unique: true}),
            this.submissions.createIndex({submissionId: 1}, {unique: true}),
            this.submissions.createIndex({attemptId: 1, clientSubmissionId: 1}, {unique: true}),
            this.submissions.createIndex({attemptId: 1, exerciseId: 1, attemptNumber: 1}, {unique: true}),
            this.submissions.createIndex({platformId: 1, deploymentId: 1, courseId: 1, resourceLinkId: 1})
        ]);
    }

    async close (): Promise<void> {
        await this.client.close();
    }

    async findOrCreateAttempt (
        scope: LaunchScope,
        subjectHash: string,
        displayName: string | null
    ): Promise<Attempt> {
        const now = new Date();
        const filter = {...scope, subjectHash};
        const attempt = await this.attempts.findOneAndUpdate(filter, {
            $set: {displayName, lastActivityAt: now},
            $setOnInsert: {
                attemptId: randomUUID(),
                activityId: 'hand-sensing-foundations',
                activityRevision: '1',
                createdAt: now
            }
        }, {upsert: true, returnDocument: 'after'});
        if (!attempt) throw new Error('Failed to create or resume the learning attempt.');
        return withoutMongoId(attempt);
    }

    async getAttempt (attemptId: string): Promise<Attempt | null> {
        const attempt = await this.attempts.findOne({attemptId});
        return attempt ? withoutMongoId(attempt) : null;
    }

    async createSession (session: Session): Promise<void> {
        await this.sessions.insertOne(session);
    }

    async getSession (tokenHash: string): Promise<Session | null> {
        const session = await this.sessions.findOne({tokenHash, expiresAt: {$gt: new Date()}});
        return session ? withoutMongoId(session) : null;
    }

    async getDraft (attemptId: string): Promise<{record: DraftRecord; artifact: Buffer} | null> {
        const draft = await this.drafts.findOne({attemptId});
        if (!draft) return null;
        const record = withoutMongoId(draft);
        return {record, artifact: await readFile(record.artifactPath)};
    }

    async saveDraft (input: SaveDraftInput): Promise<DraftRecord> {
        return await this.withLock(`draft:${input.attemptId}`, async () => {
            const previousWrite = await this.draftWrites.findOne({
                attemptId: input.attemptId,
                idempotencyKey: input.idempotencyKey
            });
            if (previousWrite) {
                if (
                    previousWrite.artifactSha256 !== input.artifactSha256 ||
                    previousWrite.version !== input.version
                ) {
                    throw new StorageConflictError('The draft idempotency key was already used for different content.');
                }
                const existing = await this.drafts.findOne({attemptId: input.attemptId});
                if (!existing) throw new Error('An idempotent draft write has no matching draft.');
                if (existing.version !== previousWrite.version) {
                    throw new StorageConflictError('The idempotent draft write has been superseded.');
                }
                return withoutMongoId(existing);
            }

            const existing = await this.drafts.findOne({attemptId: input.attemptId});
            const currentVersion = existing?.version ?? 0;
            if (currentVersion !== input.expectedVersion || input.version !== input.expectedVersion + 1) {
                throw new StorageConflictError(`Draft version conflict: current version is ${currentVersion}.`);
            }

            const artifactPath = join(
                this.dataDir,
                'drafts',
                `${digestPathPart(input.attemptId)}-v${input.version}.sb3`
            );
            await this.writeArtifact(artifactPath, input.artifact);
            const record: DraftRecord = {
                attemptId: input.attemptId,
                version: input.version,
                savedAt: new Date().toISOString(),
                byteLength: input.artifact.length,
                activityId: input.activityId,
                activityRevision: input.activityRevision,
                projectId: input.projectId,
                exerciseStatuses: input.exerciseStatuses,
                artifactPath
            };
            await this.drafts.replaceOne({attemptId: input.attemptId}, record, {upsert: true});
            await this.draftWrites.insertOne({
                attemptId: input.attemptId,
                idempotencyKey: input.idempotencyKey,
                artifactSha256: input.artifactSha256,
                version: input.version
            });
            if (existing?.artifactPath && existing.artifactPath !== artifactPath) {
                await unlink(existing.artifactPath).catch(() => undefined);
            }
            await this.attempts.updateOne({attemptId: input.attemptId}, {$set: {lastActivityAt: new Date()}});
            return record;
        });
    }

    async deleteDraft (attemptId: string): Promise<void> {
        await this.withLock(`draft:${attemptId}`, async () => {
            const draft = await this.drafts.findOneAndDelete({attemptId});
            if (draft) await unlink(draft.artifactPath).catch(() => undefined);
        });
    }

    async createSubmission (input: CreateSubmissionInput): Promise<SubmissionRecord> {
        return await this.withLock(`submission:${input.attemptId}:${input.exerciseId}`, async () => {
            const previous = await this.submissions.findOne({
                attemptId: input.attemptId,
                clientSubmissionId: input.clientSubmissionId
            });
            if (previous) {
                if (previous.sha256 !== input.sha256 || previous.exerciseId !== input.exerciseId) {
                    throw new StorageConflictError(
                        'The submission idempotency key was already used for a different artifact.'
                    );
                }
                return withoutMongoId(previous);
            }

            const latest = await this.submissions.find({
                attemptId: input.attemptId,
                exerciseId: input.exerciseId
            }).sort({attemptNumber: -1}).limit(1).next();
            const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
            const submissionId = randomUUID();
            const artifactPath = join(this.dataDir, 'submissions', `${submissionId}.sb3`);
            await this.writeArtifact(artifactPath, input.artifact);
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
                artifactPath
            };
            await this.submissions.insertOne(record);
            await this.attempts.updateOne({attemptId: input.attemptId}, {$set: {lastActivityAt: new Date()}});
            return record;
        });
    }

    async getSubmission (submissionId: string): Promise<SubmissionRecord | null> {
        const submission = await this.submissions.findOne({submissionId});
        return submission ? withoutMongoId(submission) : null;
    }

    async readArtifact (record: SubmissionRecord): Promise<Buffer> {
        return await readFile(record.artifactPath);
    }

    async listReview (scope: LaunchScope): Promise<ReviewData> {
        const [attempts, submissions] = await Promise.all([
            this.attempts.find(scope).sort({lastActivityAt: -1}).toArray(),
            this.submissions.find(scope).sort({submittedAt: 1}).toArray()
        ]);
        return {
            attempts: attempts.map(withoutMongoId),
            submissions: submissions.map(withoutMongoId)
        };
    }

    private async writeArtifact (path: string, artifact: Buffer): Promise<void> {
        await mkdir(dirname(path), {recursive: true});
        const temporaryPath = `${path}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, artifact, {flag: 'wx'});
        await rename(temporaryPath, path);
    }

    private async withLock<T> (key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        const queued = previous.then(() => current);
        this.locks.set(key, queued);
        await previous;
        try {
            return await operation();
        } finally {
            release();
            if (this.locks.get(key) === queued) this.locks.delete(key);
        }
    }
}
