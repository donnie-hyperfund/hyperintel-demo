import { NextResponse } from 'next/server';

const createError = (message: string, code: string, status: number) =>
    NextResponse.json({ error: message, code }, { status });

export const CHAT_ERRORS = {
    PROJECT_NOT_FOUND: createError('Project not found', 'PROJECT_NOT_FOUND', 404),
    CHAT_NOT_FOUND: createError('Chat not found', 'CHAT_NOT_FOUND', 404),
};

export const MESSAGE_ERRORS = {
    MESSAGE_NOT_FOUND: createError('Message not found', 'MESSAGE_NOT_FOUND', 404),
    CANNOT_MODIFY_AI_MESSAGE: createError('AI messages cannot be modified', 'CANNOT_MODIFY_AI_MESSAGE', 403),
    CANNOT_DELETE_AI_MESSAGE: createError('AI messages cannot be deleted', 'CANNOT_DELETE_AI_MESSAGE', 403),
};
