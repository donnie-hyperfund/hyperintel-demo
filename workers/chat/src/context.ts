import { AuthedInferredContext } from '@worker/context.helpers';

export type Ctx = AuthedInferredContext<ChatEnv> & {
    eCtx?: ExecutionContext;
    /** Preview branch alias — set on dev, used for DO name suffixing and DB resolution */
    previewAlias?: string | null;
    /** Stable request identifier propagated from the HTTP boundary for support/debug correlation. */
    requestId?: string | null;
    /** IANA timezone forwarded from the client (browser). Used to build the per-request date context block. */
    userTimezone?: string;
};
