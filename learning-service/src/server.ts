import {randomBytes} from 'node:crypto';

import type {NextFunction, Request, Response} from 'express';
import multer from 'multer';
import {
    IdTokenValidationMethod,
    Provider,
    type DatabaseManager,
    type LaunchContext,
    type RequestHandler
} from 'ltijs';

import {activityManifest} from './activity.js';
import type {ServiceConfig} from './config.js';
import {HttpError} from './errors.js';
import {renderReviewPage} from './html.js';
import {
    ServiceHttpHandler,
    isServiceHttpResponse,
    type ServiceHttpResponse
} from './http-handler.js';
import {
    MongoLearningRepository,
    StorageConflictError,
    type Attempt,
    type DraftRecord,
    type LaunchScope,
    type LearningRepository,
    type Session
} from './repository.js';
import {
    MAX_ARTIFACT_BYTES,
    parseDraftMetadata,
    parseJsonBuffer,
    parseSubmissionMetadata,
    sha256,
    validateSb3
} from './validation.js';

const INSTRUCTOR_ROLES = ['#Instructor', '#Administrator', '#TeachingAssistant', '#ContentDeveloper'];
const LEARNER_ROLES = ['#Learner'];

type AuthenticatedRequest = Request & {learningSession?: Session};

interface CreateServiceOptions {
    repository?: LearningRepository;
    ltiDatabaseManager?: DatabaseManager;
    ltiRequestHandler?: RequestHandler;
}

const getClaimId = (claim: Record<string, unknown> | undefined, name: string): string => {
    const id = claim?.id;
    if (typeof id !== 'string' || !id) throw new HttpError(400, `The LTI launch is missing ${name}.`);
    return id;
};

const exactTarget = (actual: string | undefined, expected: string): boolean => {
    if (!actual) return false;
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    return actualUrl.origin === expectedUrl.origin && actualUrl.pathname === expectedUrl.pathname;
};

const resolveRole = (roles: readonly string[]): 'learner' | 'teacher' => {
    if (roles.some(role => INSTRUCTOR_ROLES.some(suffix => role.endsWith(suffix)))) return 'teacher';
    if (roles.some(role => LEARNER_ROLES.some(suffix => role.endsWith(suffix)))) return 'learner';
    throw new HttpError(403, 'This LTI role is not authorized for the activity.');
};

const parseCookie = (header: string | undefined, name: string): string | null => {
    if (!header) return null;
    for (const part of header.split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
};

const filePart = (request: Request, name: string): Express.Multer.File => {
    const files = request.files as Record<string, Express.Multer.File[]> | undefined;
    const file = files?.[name]?.[0];
    if (!file) throw new HttpError(400, `Missing multipart field ${name}.`);
    return file;
};

const requiredHeader = (request: Request, name: string, maxLength = 200): string => {
    const value = request.header(name)?.trim();
    if (!value || value.length > maxLength) throw new HttpError(400, `Missing or invalid ${name} header.`);
    return value;
};

const scopeMatches = (left: LaunchScope, right: LaunchScope): boolean =>
    left.platformId === right.platformId &&
    left.deploymentId === right.deploymentId &&
    left.courseId === right.courseId &&
    left.resourceLinkId === right.resourceLinkId;

const routeParameter = (value: string | string[] | undefined, name: string): string => {
    if (typeof value !== 'string' || !value) throw new HttpError(400, `Missing route parameter ${name}.`);
    return value;
};

const publicDraftRecord = (record: DraftRecord) => ({
    schemaVersion: 1,
    id: `external:${record.attemptId}`,
    activityId: record.activityId,
    activityRevision: record.activityRevision,
    projectId: record.projectId,
    version: record.version,
    savedAt: record.savedAt,
    byteLength: record.byteLength,
    exerciseStatuses: record.exerciseStatuses
});

export class LearningService {
    readonly handler: ServiceHttpHandler;
    readonly provider: Provider;
    private readonly repository: LearningRepository;
    private initialized = false;

    constructor (private readonly config: ServiceConfig, options: CreateServiceOptions = {}) {
        this.repository = options.repository ?? new MongoLearningRepository(config.mongoUrl, config.dataDir);
        this.handler = new ServiceHttpHandler({
            port: config.port,
            editorOrigin: config.editorOrigin,
            tls: config.tls
        });
        this.provider = new Provider({
            database: options.ltiDatabaseManager ? undefined : {url: config.mongoUrl},
            databaseManager: options.ltiDatabaseManager,
            httpHandler: this.handler,
            requestHandler: options.ltiRequestHandler,
            tokenMaxAge: 60
        });
        this.provider.onResourceLink(async (context, _request, response) => {
            await this.handleLaunch(context, response as ServiceHttpResponse);
        });
        this.provider.onDeepLinking(async (_context, _request, response) => {
            response.status(501).json({error: 'DeepLinkingNotImplemented'});
        });
        this.registerApplicationRoutes();
    }

    async initialize (): Promise<void> {
        if (this.initialized) return;
        await this.repository.initialize();
        await this.provider.databaseManager.listen();
        await this.provider.cacheManager.listen();
        await this.ensurePlatformRegistration();
        this.handler.finalize();
        this.initialized = true;
    }

    async start (): Promise<void> {
        await this.initialize();
        await this.handler.listen();
        console.log(`Learning service listening at ${this.config.toolPublicBaseUrl}`);
    }

    async close (): Promise<void> {
        await this.handler.close();
        await this.provider.databaseManager.close();
        await this.provider.cacheManager.close();
        await this.repository.close();
        this.initialized = false;
    }

    private async ensurePlatformRegistration (): Promise<void> {
        const existing = await this.provider.platformManager.getPlatformByUrlAndClientId(
            this.config.lti.issuer,
            this.config.lti.clientId
        );
        const registration = {
            url: this.config.lti.issuer,
            clientId: this.config.lti.clientId,
            name: 'Configured Moodle',
            authenticationEndpoint: this.config.lti.authenticationUrl,
            accessTokenEndpoint: this.config.lti.tokenUrl,
            idTokenValidation: {
                method: IdTokenValidationMethod.JwkSet,
                key: this.config.lti.jwksUrl
            }
        };
        if (!existing) {
            await this.provider.platformManager.registerPlatform(registration);
            return;
        }
        const updated = await this.provider.platformManager.updatePlatform(existing, registration);
        if (!updated.active) await this.provider.platformManager.activatePlatform(updated);
    }

    private async handleLaunch (context: LaunchContext, response: ServiceHttpResponse): Promise<void> {
        if (!isServiceHttpResponse(response)) throw new Error('The service HTTP response cannot set a session cookie.');
        const launchUrl = `${this.config.toolPublicBaseUrl}/lti/launch`;
        if (context.idToken.platform.deploymentId !== this.config.lti.deploymentId) {
            throw new HttpError(401, 'The LTI deployment ID is not registered for this service.');
        }
        if (!exactTarget(context.idToken.launch.target, launchUrl)) {
            throw new HttpError(401, 'The LTI target link URI does not match the launch endpoint.');
        }

        const scope: LaunchScope = {
            platformId: context.idToken.platform.id,
            deploymentId: context.idToken.platform.deploymentId,
            courseId: getClaimId(context.idToken.launch.context, 'course context ID'),
            resourceLinkId: getClaimId(context.idToken.launch.resource, 'resource link ID')
        };
        const role = resolveRole(context.idToken.user.roles);
        let attempt: Attempt | null = null;
        if (role === 'learner') {
            const subjectHash = sha256([
                scope.platformId,
                scope.deploymentId,
                context.idToken.user.id
            ].join('\0'));
            const displayName = context.idToken.user.name?.slice(0, 200) || null;
            attempt = await this.repository.findOrCreateAttempt(scope, subjectHash, displayName);
        }

        const rawSessionId = randomBytes(32).toString('base64url');
        await this.repository.createSession({
            ...scope,
            tokenHash: sha256(rawSessionId),
            role,
            attemptId: attempt?.attemptId ?? null,
            expiresAt: new Date(Date.now() + this.config.sessionTtlSeconds * 1000)
        });
        response.setSessionCookie(rawSessionId, {
            maxAgeSeconds: this.config.sessionTtlSeconds,
            sameSite: this.config.sessionCookieSameSite,
            secure: this.config.sessionCookieSecure
        });

        if (role === 'teacher') {
            response.redirect(`${this.config.toolPublicBaseUrl}/review`);
            return;
        }
        const editorUrl = new URL(this.config.editorPublicUrl);
        editorUrl.searchParams.set('learningPlatform', '1');
        response.redirect(editorUrl.toString());
    }

    private registerApplicationRoutes (): void {
        const app = this.handler.app;
        const upload = multer({
            storage: multer.memoryStorage(),
            limits: {fileSize: MAX_ARTIFACT_BYTES, files: 2, fields: 2}
        }).fields([
            {name: 'metadata', maxCount: 1},
            {name: 'artifact', maxCount: 1}
        ]);

        const authenticate = async (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
            try {
                const rawSessionId = parseCookie(request.header('Cookie'), 'ft_learning_session');
                if (!rawSessionId) throw new HttpError(401, 'An authenticated LTI session is required.');
                const session = await this.repository.getSession(sha256(rawSessionId));
                if (!session) throw new HttpError(401, 'The LTI session is missing or expired.');
                request.learningSession = session;
                next();
            } catch (error) {
                next(error);
            }
        };

        const requireEditorOrigin = (request: Request, _response: Response, next: NextFunction) => {
            if (request.header('Origin') !== this.config.editorOrigin) {
                next(new HttpError(403, 'The request origin is not authorized for editor mutations.'));
                return;
            }
            next();
        };

        const learnerAttempt = async (request: AuthenticatedRequest): Promise<Attempt> => {
            const session = request.learningSession;
            if (!session || session.role !== 'learner' || !session.attemptId) {
                throw new HttpError(403, 'A learner session is required.');
            }
            if (request.params.attemptId !== session.attemptId) {
                throw new HttpError(403, 'The attempt is not owned by this session.');
            }
            const attempt = await this.repository.getAttempt(session.attemptId);
            if (!attempt || !scopeMatches(attempt, session)) {
                throw new HttpError(403, 'The attempt is outside this course activity.');
            }
            return attempt;
        };

        app.get('/health', (_request, response) => response.json({status: 'ok'}));

        app.get('/v1/session/bootstrap', authenticate, async (request: AuthenticatedRequest, response, next) => {
            try {
                const session = request.learningSession;
                if (!session || session.role !== 'learner' || !session.attemptId) {
                    throw new HttpError(403, 'A learner session is required.');
                }
                response.setHeader('Cache-Control', 'no-store');
                response.json({
                    schemaVersion: 1,
                    mode: 'learner',
                    attemptId: session.attemptId,
                    manifest: activityManifest
                });
            } catch (error) {
                next(error);
            }
        });

        app.get('/v1/attempts/:attemptId/draft', authenticate, async (request: AuthenticatedRequest, response, next) => {
            try {
                await learnerAttempt(request);
                const result = await this.repository.getDraft(routeParameter(request.params.attemptId, 'attemptId'));
                response.setHeader('Cache-Control', 'no-store');
                if (!result) {
                    response.status(404).json({error: 'DraftNotFound'});
                    return;
                }
                response.setHeader('ETag', `"${result.record.version}"`);
                response.json({
                    record: publicDraftRecord(result.record),
                    projectBase64: result.artifact.toString('base64')
                });
            } catch (error) {
                next(error);
            }
        });

        app.put('/v1/attempts/:attemptId/draft', authenticate, requireEditorOrigin, upload,
            async (request: AuthenticatedRequest, response, next) => {
                try {
                    const attempt = await learnerAttempt(request);
                    const metadataFile = filePart(request, 'metadata');
                    const artifactFile = filePart(request, 'artifact');
                    const metadata = parseDraftMetadata(parseJsonBuffer(metadataFile.buffer, 'metadata'));
                    validateSb3(artifactFile.buffer);
                    const ifMatch = requiredHeader(request, 'If-Match', 20).replace(/^"|"$/g, '');
                    if (!/^\d+$/.test(ifMatch)) throw new HttpError(400, 'If-Match must contain a draft version.');
                    const idempotencyKey = requiredHeader(request, 'Idempotency-Key');
                    const record = await this.repository.saveDraft({
                        attemptId: attempt.attemptId,
                        expectedVersion: Number(ifMatch),
                        idempotencyKey,
                        artifact: artifactFile.buffer,
                        artifactSha256: sha256(artifactFile.buffer),
                        activityId: metadata.activityId,
                        activityRevision: metadata.activityRevision,
                        projectId: metadata.projectId,
                        version: metadata.version,
                        exerciseStatuses: metadata.exerciseStatuses
                    });
                    response.setHeader('ETag', `"${record.version}"`);
                    response.json({record: publicDraftRecord(record)});
                } catch (error) {
                    next(error instanceof StorageConflictError ? new HttpError(409, error.message) : error);
                }
            });

        app.delete('/v1/attempts/:attemptId/draft', authenticate, requireEditorOrigin,
            async (request: AuthenticatedRequest, response, next) => {
                try {
                    const attempt = await learnerAttempt(request);
                    await this.repository.deleteDraft(attempt.attemptId);
                    response.sendStatus(204);
                } catch (error) {
                    next(error);
                }
            });

        app.post('/v1/attempts/:attemptId/submissions', authenticate, requireEditorOrigin, upload,
            async (request: AuthenticatedRequest, response, next) => {
                try {
                    const attempt = await learnerAttempt(request);
                    const metadataFile = filePart(request, 'metadata');
                    const artifactFile = filePart(request, 'artifact');
                    const metadata = parseSubmissionMetadata(parseJsonBuffer(metadataFile.buffer, 'metadata'));
                    validateSb3(artifactFile.buffer);
                    const idempotencyKey = requiredHeader(request, 'Idempotency-Key');
                    if (idempotencyKey !== metadata.clientSubmissionId) {
                        throw new HttpError(400, 'Idempotency-Key must match clientSubmissionId.');
                    }
                    if (metadata.attemptId !== attempt.attemptId) {
                        throw new HttpError(403, 'Submission metadata does not belong to this attempt.');
                    }
                    if (
                        metadata.artifact.byteLength !== artifactFile.buffer.length ||
                        metadata.artifact.sha256 !== sha256(artifactFile.buffer)
                    ) {
                        throw new HttpError(400, 'Artifact size or digest does not match the submission metadata.');
                    }
                    const record = await this.repository.createSubmission({
                        ...attempt,
                        clientSubmissionId: metadata.clientSubmissionId,
                        exerciseId: metadata.exerciseId,
                        projectId: metadata.projectId,
                        fileName: metadata.artifact.fileName,
                        mediaType: metadata.artifact.mediaType,
                        byteLength: metadata.artifact.byteLength,
                        sha256: metadata.artifact.sha256,
                        exerciseStatuses: metadata.evidence.exerciseStatuses,
                        artifact: artifactFile.buffer
                    });
                    response.status(201).json({
                        submissionId: record.submissionId,
                        submittedAt: record.submittedAt,
                        attemptNumber: record.attemptNumber
                    });
                } catch (error) {
                    next(error instanceof StorageConflictError ? new HttpError(409, error.message) : error);
                }
            });

        app.get('/review', authenticate, async (request: AuthenticatedRequest, response, next) => {
            try {
                const session = request.learningSession;
                if (!session || session.role !== 'teacher') throw new HttpError(403, 'A teacher session is required.');
                const review = await this.repository.listReview(session);
                response.setHeader('Cache-Control', 'no-store');
                response.type('html').send(renderReviewPage(activityManifest, review));
            } catch (error) {
                next(error);
            }
        });

        app.get('/v1/submissions/:submissionId/artifact', authenticate,
            async (request: AuthenticatedRequest, response, next) => {
                try {
                    const session = request.learningSession!;
                    const submission = await this.repository.getSubmission(
                        routeParameter(request.params.submissionId, 'submissionId')
                    );
                    if (!submission || !scopeMatches(submission, session)) {
                        throw new HttpError(404, 'Submission not found.');
                    }
                    if (session.role === 'learner' && submission.attemptId !== session.attemptId) {
                        throw new HttpError(404, 'Submission not found.');
                    }
                    const artifact = await this.repository.readArtifact(submission);
                    response.setHeader('Cache-Control', 'private, no-store');
                    response.setHeader('Content-Type', 'application/x.scratch.sb3');
                    response.setHeader('Content-Disposition',
                        `attachment; filename="${submission.fileName.replace(/\.sb3$/, '')}-v${submission.attemptNumber}.sb3"`);
                    response.send(artifact);
                } catch (error) {
                    next(error);
                }
            });
    }
}
