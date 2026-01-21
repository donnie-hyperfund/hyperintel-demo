import { AuthedInferredContext } from '@worker/context.helpers';

export type Ctx = AuthedInferredContext<Env> & { eCtx?: ExecutionContext };
