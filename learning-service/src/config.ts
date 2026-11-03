import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export type SameSite = 'Lax' | 'None' | 'Strict';

export interface ServiceConfig {
    port: number;
    toolPublicBaseUrl: string;
    editorPublicUrl: string;
    editorOrigin: string;
    mongoUrl: string;
    dataDir: string;
    sessionTtlSeconds: number;
    sessionCookieSecure: boolean;
    sessionCookieSameSite: SameSite;
    tls?: {key: string; cert: string};
    lti: {
        issuer: string;
        clientId: string;
        deploymentId: string;
        authenticationUrl: string;
        tokenUrl: string;
        jwksUrl: string;
    };
}

const required = (env: NodeJS.ProcessEnv, name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing required environment variable ${name}.`);
    return value;
};

const positiveInteger = (raw: string, name: string): number => {
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
    return value;
};

const booleanValue = (raw: string, name: string): boolean => {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`${name} must be true or false.`);
};

const normalizedOrigin = (raw: string, name: string): string => {
    const url = new URL(raw);
    if (url.origin !== raw.replace(/\/$/, '')) throw new Error(`${name} must contain an origin only.`);
    return url.origin;
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ServiceConfig => {
    const toolPublicBaseUrl = required(env, 'TOOL_PUBLIC_BASE_URL').replace(/\/$/, '');
    const editorPublicUrl = required(env, 'EDITOR_PUBLIC_URL');
    const editorOrigin = normalizedOrigin(required(env, 'EDITOR_ORIGIN'), 'EDITOR_ORIGIN');
    const sessionCookieSecure = booleanValue(env.SESSION_COOKIE_SECURE ?? 'false', 'SESSION_COOKIE_SECURE');
    const sessionCookieSameSite = (env.SESSION_COOKIE_SAME_SITE ?? 'Lax') as SameSite;
    if (!['Lax', 'None', 'Strict'].includes(sessionCookieSameSite)) {
        throw new Error('SESSION_COOKIE_SAME_SITE must be Lax, None, or Strict.');
    }
    if (sessionCookieSameSite === 'None' && !sessionCookieSecure) {
        throw new Error('SESSION_COOKIE_SAME_SITE=None requires SESSION_COOKIE_SECURE=true.');
    }
    if (new URL(toolPublicBaseUrl).protocol === 'https:' && !sessionCookieSecure) {
        throw new Error('HTTPS TOOL_PUBLIC_BASE_URL requires SESSION_COOKIE_SECURE=true.');
    }
    if (new URL(editorPublicUrl).origin !== editorOrigin) {
        throw new Error('EDITOR_PUBLIC_URL must use EDITOR_ORIGIN.');
    }

    const tlsKeyFile = env.TLS_KEY_FILE?.trim();
    const tlsCertFile = env.TLS_CERT_FILE?.trim();
    if (Boolean(tlsKeyFile) !== Boolean(tlsCertFile)) {
        throw new Error('TLS_KEY_FILE and TLS_CERT_FILE must be configured together.');
    }

    return {
        port: positiveInteger(env.PORT ?? '8700', 'PORT'),
        toolPublicBaseUrl,
        editorPublicUrl,
        editorOrigin,
        mongoUrl: required(env, 'MONGO_URL'),
        dataDir: resolve(env.DATA_DIR?.trim() || './data'),
        sessionTtlSeconds: positiveInteger(env.SESSION_TTL_SECONDS ?? '28800', 'SESSION_TTL_SECONDS'),
        sessionCookieSecure,
        sessionCookieSameSite,
        tls: tlsKeyFile && tlsCertFile ? {
            key: readFileSync(resolve(tlsKeyFile), 'utf8'),
            cert: readFileSync(resolve(tlsCertFile), 'utf8')
        } : undefined,
        lti: {
            issuer: required(env, 'LTI_ISSUER'),
            clientId: required(env, 'LTI_CLIENT_ID'),
            deploymentId: required(env, 'LTI_DEPLOYMENT_ID'),
            authenticationUrl: required(env, 'LTI_AUTH_URL'),
            tokenUrl: required(env, 'LTI_TOKEN_URL'),
            jwksUrl: required(env, 'LTI_JWKS_URL')
        }
    };
};
