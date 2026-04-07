import { S3Client } from '@aws-sdk/client-s3';

interface R2Credentials {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
}

/**
 * Create an S3-compatible client for Cloudflare R2.
 * Works from both Next.js (process.env) and CF Workers (env secrets).
 */
export function createR2Client(creds: R2Credentials): S3Client {
    return new S3Client({
        region: 'auto',
        endpoint: `https://${creds.accountId}.r2.cloudflarestorage.com`,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
        },
    });
}

/**
 * Read R2 credentials from process.env (Next.js / local dev).
 * Returns null if any credential is missing.
 */
export function getR2CredentialsFromEnv(): R2Credentials | null {
    const accountId = process.env.CF_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) return null;
    return { accountId, accessKeyId, secretAccessKey };
}

/**
 * Read R2 credentials from CF Worker secret bindings.
 */
export async function getR2CredentialsFromWorkerEnv(env: {
    CF_ACCOUNT_ID: { get(): Promise<string> };
    R2_ACCESS_KEY_ID: { get(): Promise<string> };
    R2_SECRET_ACCESS_KEY: { get(): Promise<string> };
}): Promise<R2Credentials | null> {
    const [accountId, accessKeyId, secretAccessKey] = await Promise.all([
        env.CF_ACCOUNT_ID.get(),
        env.R2_ACCESS_KEY_ID.get(),
        env.R2_SECRET_ACCESS_KEY.get(),
    ]);
    if (!accountId || !accessKeyId || !secretAccessKey) return null;
    return { accountId, accessKeyId, secretAccessKey };
}
