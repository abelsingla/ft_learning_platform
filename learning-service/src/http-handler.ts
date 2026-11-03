import {createServer as createHttpServer, type Server} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';

import express, {type Express, type Request, type Response} from 'express';
import helmet from 'helmet';
import {
    HttpMethod,
    LtijsError,
    type HttpHandler,
    type HttpRequestParameters,
    type HttpResponse,
    type RouteHandler
} from 'ltijs';

import type {SameSite} from './config.js';
import {HttpError} from './errors.js';

export interface SessionCookieOptions {
    maxAgeSeconds: number;
    sameSite: SameSite;
    secure: boolean;
}

export interface ServiceHttpResponse extends HttpResponse {
    setSessionCookie(value: string, options: SessionCookieOptions): void;
}

interface ServiceHttpHandlerOptions {
    port: number;
    editorOrigin: string;
    tls?: {key: string; cert: string};
}

class ExpressServiceResponse implements ServiceHttpResponse {
    constructor (private readonly response: Response) {}

    status (code: number): this {
        this.response.status(code);
        return this;
    }

    redirect (url: string): void {
        this.response.redirect(url);
    }

    html (content: string): void {
        this.response.type('html').send(content);
    }

    json (body: unknown): void {
        this.response.json(body);
    }

    setSessionCookie (value: string, options: SessionCookieOptions): void {
        const attributes = [
            `ft_learning_session=${encodeURIComponent(value)}`,
            'Path=/',
            'HttpOnly',
            `SameSite=${options.sameSite}`,
            `Max-Age=${options.maxAgeSeconds}`
        ];
        if (options.secure) attributes.push('Secure');
        this.response.appendHeader('Set-Cookie', attributes.join('; '));
    }
}

const methodName = (method: HttpMethod): 'get' | 'post' | 'put' | 'delete' | 'all' => {
    switch (method) {
    case HttpMethod.Get: return 'get';
    case HttpMethod.Post: return 'post';
    case HttpMethod.Put: return 'put';
    case HttpMethod.Delete: return 'delete';
    case HttpMethod.All: return 'all';
    }
};

export class ServiceHttpHandler implements HttpHandler {
    readonly app: Express;
    private server?: Server;
    private finalized = false;

    constructor (private readonly options: ServiceHttpHandlerOptions) {
        this.app = express();
        this.app.disable('x-powered-by');
        this.app.use(helmet({frameguard: false, contentSecurityPolicy: false}));
        this.app.use((request, response, next) => {
            const origin = request.header('Origin');
            if (origin === this.options.editorOrigin) {
                response.setHeader('Access-Control-Allow-Origin', origin);
                response.setHeader('Access-Control-Allow-Credentials', 'true');
                response.setHeader('Access-Control-Allow-Headers',
                    'Content-Type, Idempotency-Key, If-Match, X-Artifact-Sha256');
                response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
                response.appendHeader('Vary', 'Origin');
            }
            if (request.method === 'OPTIONS') {
                response.sendStatus(origin === this.options.editorOrigin ? 204 : 403);
                return;
            }
            next();
        });
        this.app.use(express.json({limit: '2mb'}));
        this.app.use(express.urlencoded({extended: false, limit: '2mb'}));
    }

    registerRoute (path: string, methods: HttpMethod[], handler: RouteHandler): void {
        const adapter = async (request: Request, response: Response): Promise<void> => {
            try {
                await handler(this.requestParameters(request), new ExpressServiceResponse(response));
            } catch (error) {
                this.sendError(error, response);
            }
        };
        for (const method of methods) this.app[methodName(method)](path, adapter);
    }

    finalize (): void {
        if (this.finalized) return;
        this.finalized = true;
        this.app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
            void _next;
            this.sendError(error, response);
        });
    }

    async listen (): Promise<void> {
        this.finalize();
        await new Promise<void>((resolve, reject) => {
            this.server = this.options.tls ?
                createHttpsServer(this.options.tls, this.app) : createHttpServer(this.app);
            this.server.once('error', reject);
            this.server.listen(this.options.port, resolve);
        });
    }

    async close (): Promise<void> {
        if (!this.server) return;
        await new Promise<void>((resolve, reject) => {
            this.server?.close(error => error ? reject(error) : resolve());
        });
    }

    private requestParameters (request: Request): HttpRequestParameters {
        return {
            method: request.method,
            path: request.path,
            query: request.query as Record<string, string | string[]>,
            body: (request.body ?? {}) as Record<string, unknown>,
            headers: request.headers as Record<string, string | string[]>
        };
    }

    private sendError (error: unknown, response: Response): void {
        if (response.headersSent) return;
        if (error instanceof HttpError) {
            response.status(error.status).json({error: error.name, message: error.message});
            return;
        }
        if (error instanceof LtijsError) {
            response.status(400).json({error: error.name, message: error.message});
            return;
        }
        if (error instanceof Error && ['JsonWebTokenError', 'TokenExpiredError'].includes(error.name)) {
            response.status(400).json({error: 'InvalidLtiToken', message: 'The LTI token is invalid.'});
            return;
        }
        const status = typeof error === 'object' && error !== null &&
            'code' in error && error.code === 'LIMIT_FILE_SIZE' ? 413 : 500;
        if (status === 500) console.error(error);
        response.status(status).json({error: status === 413 ? 'ArtifactTooLarge' : 'InternalServerError'});
    }
}

export const isServiceHttpResponse = (response: HttpResponse): response is ServiceHttpResponse =>
    typeof (response as Partial<ServiceHttpResponse>).setSessionCookie === 'function';
