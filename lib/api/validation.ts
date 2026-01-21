import { NextResponse } from 'next/server';
import { type z } from 'zod';

export function validatePayload<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> | NextResponse {
    const result = schema.safeParse(data);

    if (!result.success) {
        return NextResponse.json(
            {
                error: 'Invalid request',
                code: 'BAD_REQUEST',
                details: result.error.errors,
            },
            { status: 400 },
        );
    }

    return result.data;
}
