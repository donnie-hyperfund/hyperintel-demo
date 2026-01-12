import { NextResponse } from 'next/server';

const createError = (message: string, code: string, status: number) =>
    NextResponse.json({ error: message, code }, { status });

export const PROJECT_ERRORS = {
    PROJECT_NOT_FOUND: createError('Project not found', 'PROJECT_NOT_FOUND', 404),
};
