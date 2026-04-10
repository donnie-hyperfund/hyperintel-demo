/**
 * Mock R2Bucket for local development.
 *
 * Wraps the AWS SDK S3 client behind the CF R2Bucket interface (.get, .put, .head, .delete).
 * Hits real R2 (dev bucket) using credentials from process.env — same bucket that
 * presigned uploads target, so reads are consistent.
 */

import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    PutObjectCommand,
    type S3Client,
} from '@aws-sdk/client-s3';
import { createR2Client, getR2CredentialsFromEnv } from '@/lib/vendor/r2';

class MockR2Object {
    readonly httpMetadata: { contentType?: string };

    constructor(
        private rawBody: NodeJS.ReadableStream | null,
        contentType?: string,
    ) {
        this.httpMetadata = { contentType: contentType ?? undefined };
    }

    /** Used by extraction worker to read file bytes. */
    async arrayBuffer(): Promise<ArrayBuffer> {
        if (!this.rawBody) throw new Error('MockR2Object: no body (head-only)');
        const chunks: Buffer[] = [];
        for await (const chunk of this.rawBody) {
            chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks).buffer as ArrayBuffer;
    }

    /** Used by chat worker to stream images directly into Response. */
    get body(): ReadableStream | null {
        if (!this.rawBody) return null;
        const readable = this.rawBody;
        return new ReadableStream({
            start(controller) {
                readable.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
                readable.on('end', () => controller.close());
                readable.on('error', (err: Error) => controller.error(err));
            },
        });
    }
}

export class MockR2Bucket {
    private client: S3Client | null = null;

    constructor(private bucketName: string) {}

    private getClient(): S3Client {
        if (!this.client) {
            const creds = getR2CredentialsFromEnv();
            if (!creds) throw new Error('[MockR2Bucket] R2 credentials not configured (CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
            this.client = createR2Client(creds);
        }
        return this.client;
    }

    async get(key: string): Promise<MockR2Object | null> {
        try {
            const resp = await this.getClient().send(new GetObjectCommand({ Bucket: this.bucketName, Key: key }));
            return new MockR2Object(resp.Body as NodeJS.ReadableStream, resp.ContentType ?? undefined);
        } catch (e: any) {
            if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
            throw e;
        }
    }

    async put(key: string, body: ArrayBuffer | ReadableStream | Buffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }): Promise<MockR2Object> {
        const s3Body = body instanceof ArrayBuffer ? Buffer.from(body) : body;
        await this.getClient().send(new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: s3Body as any,
            ContentType: options?.httpMetadata?.contentType,
        }));
        return new MockR2Object(null, options?.httpMetadata?.contentType);
    }

    async head(key: string): Promise<MockR2Object | null> {
        try {
            const resp = await this.getClient().send(new HeadObjectCommand({ Bucket: this.bucketName, Key: key }));
            return new MockR2Object(null, resp.ContentType ?? undefined);
        } catch (e: any) {
            if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
            throw e;
        }
    }

    async delete(key: string | string[]): Promise<void> {
        const keys = Array.isArray(key) ? key : [key];
        await Promise.all(keys.map((k) =>
            this.getClient().send(new DeleteObjectCommand({ Bucket: this.bucketName, Key: k })),
        ));
    }
}
