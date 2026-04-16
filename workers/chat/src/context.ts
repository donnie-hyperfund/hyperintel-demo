import { AuthedInferredContext } from '@worker/context.helpers';

export type Ctx = AuthedInferredContext<Env> & {
    eCtx?: ExecutionContext;
    /** Preview branch alias — set on dev, used for DO name suffixing and DB resolution */
    previewAlias?: string | null;
    /** Stable request identifier propagated from the HTTP boundary for support/debug correlation. */
    requestId?: string | null;
};
