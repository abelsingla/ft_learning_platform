import {generateKeyPairSync, sign as signBytes, type KeyObject} from 'node:crypto';

import request from 'supertest';
import type {RequestHandler, RequestResponse} from 'ltijs';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import type {ServiceConfig} from '../src/config.js';
import {LearningService} from '../src/server.js';
import {sha256} from '../src/validation.js';
import {MemoryLearningRepository, MemoryLtiDatabase} from './memory.js';

const DEPLOYMENT_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/deployment_id';
const MESSAGE_TYPE_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/message_type';
const VERSION_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/version';
const ROLES_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/roles';
const TARGET_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/target_link_uri';
const CONTEXT_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/context';
const RESOURCE_CLAIM = 'https://purl.imsglobal.org/spec/lti/claim/resource_link';

const learnerRole = 'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner';
const instructorRole = 'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor';
const sb3 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x66, 0x74]);

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const signJwt = (payload: Record<string, unknown>, privateKey: KeyObject, kid = 'moodle-key'): string => {
    const unsigned = `${encode({alg: 'RS256', typ: 'JWT', kid})}.${encode(payload)}`;
    const signature = signBytes('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
    return `${unsigned}.${signature}`;
};

const extractLoginData = (html: string): Record<string, string> => {
    const match = html.match(/<script type="application\/json" id="ltijs-login-data">([\s\S]*?)<\/script>/);
    if (!match?.[1]) throw new Error('ltijs login data was not present.');
    return JSON.parse(match[1]) as Record<string, string>;
};

const cookieFrom = (response: request.Response): string => {
    const cookies = response.headers['set-cookie'];
    const value = Array.isArray(cookies) ? cookies[0] : cookies;
    if (!value) throw new Error('Session cookie was not set.');
    return value.split(';')[0]!;
};

describe('Moodle LTI vertical slice', () => {
    let service: LearningService;
    let repository: MemoryLearningRepository;
    let ltiDatabase: MemoryLtiDatabase;
    let privateKey: KeyObject;
    let config: ServiceConfig;

    beforeEach(async () => {
        const keys = generateKeyPairSync('rsa', {modulusLength: 2048});
        privateKey = keys.privateKey;
        const jwk = keys.publicKey.export({format: 'jwk'});
        const requestHandler: RequestHandler = {
            get: async <T>(): Promise<RequestResponse<T>> => ({
                data: {keys: [{...jwk, kid: 'moodle-key', alg: 'RS256', use: 'sig'}]} as T,
                headers: {}
            }),
            post: async <T>(): Promise<RequestResponse<T>> => ({data: {} as T, headers: {}}),
            put: async <T>(): Promise<RequestResponse<T>> => ({data: {} as T, headers: {}}),
            delete: async <T>(): Promise<RequestResponse<T>> => ({data: {} as T, headers: {}}),
            setPermanentHeader: () => undefined
        };
        config = {
            port: 8700,
            toolPublicBaseUrl: 'http://localhost:8700',
            editorPublicUrl: 'http://localhost:8601/',
            editorOrigin: 'http://localhost:8601',
            mongoUrl: 'mongodb://unused/test',
            dataDir: '/unused',
            sessionTtlSeconds: 3600,
            sessionCookieSecure: false,
            sessionCookieSameSite: 'Lax',
            lti: {
                issuer: 'http://moodle.test',
                clientId: 'client-1',
                deploymentId: 'deployment-1',
                authenticationUrl: 'http://moodle.test/auth',
                tokenUrl: 'http://moodle.test/token',
                jwksUrl: 'http://moodle.test/jwks'
            }
        };
        repository = new MemoryLearningRepository();
        ltiDatabase = new MemoryLtiDatabase();
        service = new LearningService(config, {
            repository,
            ltiDatabaseManager: ltiDatabase,
            ltiRequestHandler: requestHandler
        });
        await service.initialize();
    });

    afterEach(async () => {
        await service.close();
    });

    const beginLaunch = async (): Promise<{state: string; recoveryToken: string; nonce: string}> => {
        const response = await request(service.handler.app)
            .get('/lti/login')
            .query({
                iss: config.lti.issuer,
                client_id: config.lti.clientId,
                login_hint: 'opaque-login-hint',
                target_link_uri: `${config.toolPublicBaseUrl}/lti/launch`,
                lti_deployment_id: config.lti.deploymentId
            })
            .expect(200);
        const data = extractLoginData(response.text);
        const authorizationUrl = new URL(data.targetUrl!);
        return {
            state: data.state!,
            recoveryToken: data.recoveryToken!,
            nonce: authorizationUrl.searchParams.get('nonce')!
        };
    };

    const launch = async ({
        sub = 'learner-1',
        role = learnerRole,
        courseId = 'course-1',
        resourceLinkId = 'resource-1',
        deploymentId = config.lti.deploymentId,
        signingKey = privateKey,
        name = 'Learner One'
    } = {}): Promise<request.Response> => {
        const login = await beginLaunch();
        const now = Math.floor(Date.now() / 1000);
        const idToken = signJwt({
            iss: config.lti.issuer,
            sub,
            aud: config.lti.clientId,
            iat: now,
            exp: now + 60,
            nonce: login.nonce,
            name,
            [DEPLOYMENT_CLAIM]: deploymentId,
            [MESSAGE_TYPE_CLAIM]: 'LtiResourceLinkRequest',
            [VERSION_CLAIM]: '1.3.0',
            [ROLES_CLAIM]: [role],
            [TARGET_CLAIM]: `${config.toolPublicBaseUrl}/lti/launch`,
            [CONTEXT_CLAIM]: {id: courseId},
            [RESOURCE_CLAIM]: {id: resourceLinkId}
        }, signingKey);
        return request(service.handler.app)
            .post('/lti/launch')
            .set('Sec-Fetch-Site', 'same-origin')
            .type('form')
            .send({
                id_token: idToken,
                state: login.state,
                ltijs_recovered_state: login.recoveryToken
            });
    };

    const bootstrap = async (cookie: string) => request(service.handler.app)
        .get('/v1/session/bootstrap')
        .set('Cookie', cookie)
        .expect(200);

    test('accepts a valid launch, creates an HttpOnly session, and rejects invalid launches', async () => {
        const valid = await launch();
        expect(valid.status).toBe(302);
        expect(valid.headers.location).toBe('http://localhost:8601/?learningPlatform=1');
        const validCookieHeader = String(valid.headers['set-cookie']?.[0]);
        expect(validCookieHeader).toContain('HttpOnly');
        expect(validCookieHeader).toContain('SameSite=Lax');
        const session = await bootstrap(cookieFrom(valid));
        expect(session.body).toMatchObject({
            schemaVersion: 1,
            mode: 'learner',
            manifest: {activityId: 'hand-sensing-foundations', revision: '1'}
        });

        const invalidKeys = generateKeyPairSync('rsa', {modulusLength: 2048});
        expect((await launch({sub: 'invalid-signature', signingKey: invalidKeys.privateKey})).status).toBe(400);
        expect((await launch({sub: 'wrong-deployment', deploymentId: 'other-deployment'})).status).toBe(401);
    });

    test('rejects replay of an otherwise valid launch', async () => {
        const login = await beginLaunch();
        const now = Math.floor(Date.now() / 1000);
        const idToken = signJwt({
            iss: config.lti.issuer,
            sub: 'replay-learner',
            aud: config.lti.clientId,
            iat: now,
            exp: now + 60,
            nonce: login.nonce,
            [DEPLOYMENT_CLAIM]: config.lti.deploymentId,
            [MESSAGE_TYPE_CLAIM]: 'LtiResourceLinkRequest',
            [VERSION_CLAIM]: '1.3.0',
            [ROLES_CLAIM]: [learnerRole],
            [TARGET_CLAIM]: `${config.toolPublicBaseUrl}/lti/launch`,
            [CONTEXT_CLAIM]: {id: 'course-1'},
            [RESOURCE_CLAIM]: {id: 'resource-1'}
        }, privateKey);
        const send = () => request(service.handler.app)
            .post('/lti/launch')
            .set('Sec-Fetch-Site', 'same-origin')
            .type('form')
            .send({id_token: idToken, state: login.state, ltijs_recovered_state: login.recoveryToken});
        expect((await send()).status).toBe(302);
        expect((await send()).status).toBe(400);
    });

    test('isolates attempts, restores remote drafts, and makes submission retries immutable', async () => {
        const learnerOne = await launch({sub: 'learner-1'});
        const learnerTwo = await launch({sub: 'learner-2'});
        const cookieOne = cookieFrom(learnerOne);
        const cookieTwo = cookieFrom(learnerTwo);
        const attemptOne = (await bootstrap(cookieOne)).body.attemptId as string;
        const attemptTwo = (await bootstrap(cookieTwo)).body.attemptId as string;

        await request(service.handler.app)
            .get(`/v1/attempts/${attemptTwo}/draft`)
            .set('Cookie', cookieOne)
            .expect(403);

        const draftMetadata = {
            schemaVersion: 1,
            id: `external:${attemptOne}`,
            activityId: 'hand-sensing-foundations',
            activityRevision: '1',
            projectId: null,
            version: 1,
            savedAt: new Date().toISOString(),
            byteLength: sb3.length,
            exerciseStatuses: {'detect-a-hand': 'completed'}
        };
        await request(service.handler.app)
            .put(`/v1/attempts/${attemptOne}/draft`)
            .set('Cookie', cookieOne)
            .set('Origin', config.editorOrigin)
            .set('If-Match', '"0"')
            .set('Idempotency-Key', 'draft-write-1')
            .attach('metadata', Buffer.from(JSON.stringify(draftMetadata)), {
                filename: 'metadata.json', contentType: 'application/json'
            })
            .attach('artifact', sb3, {filename: 'draft.sb3', contentType: 'application/x.scratch.sb3'})
            .expect(200);
        const restored = await request(service.handler.app)
            .get(`/v1/attempts/${attemptOne}/draft`)
            .set('Cookie', cookieOne)
            .expect(200);
        expect(Buffer.from(restored.body.projectBase64, 'base64')).toEqual(sb3);
        expect(restored.body.record.exerciseStatuses).toEqual({'detect-a-hand': 'completed'});

        const submissionMetadata = (clientSubmissionId: string, artifact = sb3) => ({
            schemaVersion: 1,
            clientSubmissionId,
            attemptId: attemptOne,
            activityId: 'hand-sensing-foundations',
            activityRevision: '1',
            exerciseId: 'detect-a-hand',
            projectId: null,
            createdAt: new Date().toISOString(),
            artifact: {
                fileName: 'hand-sensing-foundations-detect-a-hand.sb3',
                mediaType: 'application/x.scratch.sb3',
                byteLength: artifact.length,
                sha256: sha256(artifact)
            },
            evidence: {exerciseStatuses: {'detect-a-hand': 'completed'}}
        });
        const submit = (metadata: ReturnType<typeof submissionMetadata>, artifact = sb3) =>
            request(service.handler.app)
                .post(`/v1/attempts/${attemptOne}/submissions`)
                .set('Cookie', cookieOne)
                .set('Origin', config.editorOrigin)
                .set('Idempotency-Key', metadata.clientSubmissionId)
                .attach('metadata', Buffer.from(JSON.stringify(metadata)), {
                    filename: 'metadata.json', contentType: 'application/json'
                })
                .attach('artifact', artifact, {filename: 'project.sb3', contentType: 'application/x.scratch.sb3'});

        const firstMetadata = submissionMetadata('submission-1');
        const first = await submit(firstMetadata).expect(201);
        const retry = await submit(firstMetadata).expect(201);
        expect(retry.body).toEqual(first.body);
        expect(first.body.attemptNumber).toBe(1);

        const changedSb3 = Buffer.concat([sb3, Buffer.from('changed')]);
        await submit(submissionMetadata('submission-1', changedSb3), changedSb3).expect(409);
        const second = await submit(submissionMetadata('submission-2')).expect(201);
        expect(second.body.attemptNumber).toBe(2);
        expect(repository.submissions.size).toBe(2);

        const teacher = await launch({sub: 'teacher-1', role: instructorRole, name: 'Teacher One'});
        expect(teacher.headers.location).toBe('http://localhost:8700/review');
        await request(service.handler.app)
            .get('/v1/session/bootstrap')
            .set('Cookie', cookieFrom(teacher))
            .expect(403);
        await request(service.handler.app)
            .get('/review')
            .set('Cookie', cookieOne)
            .expect(403);
        const review = await request(service.handler.app)
            .get('/review')
            .set('Cookie', cookieFrom(teacher))
            .expect(200);
        expect(review.text).toContain('Learner One');
        expect(review.text).toContain('Version 1');
        expect(review.text).toContain('Version 2');

        await request(service.handler.app)
            .get(`/v1/submissions/${first.body.submissionId}/artifact`)
            .set('Cookie', cookieFrom(teacher))
            .expect(200)
            .expect('Content-Type', /application\/x\.scratch\.sb3/);

        const otherTeacher = await launch({
            sub: 'teacher-2', role: instructorRole, courseId: 'other-course', name: 'Other Teacher'
        });
        const isolatedReview = await request(service.handler.app)
            .get('/review')
            .set('Cookie', cookieFrom(otherTeacher))
            .expect(200);
        expect(isolatedReview.text).not.toContain('Learner One');

        const otherResourceTeacher = await launch({
            sub: 'teacher-3', role: instructorRole, resourceLinkId: 'other-resource', name: 'Resource Teacher'
        });
        const resourceIsolatedReview = await request(service.handler.app)
            .get('/review')
            .set('Cookie', cookieFrom(otherResourceTeacher))
            .expect(200);
        expect(resourceIsolatedReview.text).not.toContain('Learner One');
        await request(service.handler.app)
            .get(`/v1/submissions/${first.body.submissionId}/artifact`)
            .set('Cookie', cookieFrom(otherResourceTeacher))
            .expect(404);
    });
});
