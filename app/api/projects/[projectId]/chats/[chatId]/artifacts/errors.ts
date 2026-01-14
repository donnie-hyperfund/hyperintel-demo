import { NextResponse } from 'next/server';

const createError = (message: string, code: string, status: number) =>
    NextResponse.json({ error: message, code }, { status });

export const ARTIFACT_ERRORS = {
    ARTIFACT_NOT_FOUND: createError('Artifact not found', 'ARTIFACT_NOT_FOUND', 404),
};
