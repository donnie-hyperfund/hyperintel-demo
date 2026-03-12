export enum WORKERS_LOCAL_ENDPOINTS {
    ChatAction = '/api/chat/handler',
    IntakeAction = '/api/intake/handler',
    SummarizeAction = '/api/chat/summarize',
    ApproveAction = '/api/chat/artifacts/approve',
    RejectAction = '/api/chat/artifacts/reject',
    ImportAction = '/api/chat/artifacts/import',
    UploadAction = '/api/chat/artifacts/upload',
    PresignAction = '/api/chat/artifacts/upload/presign',
    ConfirmAction = '/api/chat/artifacts/upload/confirm',
    ExportAction = '/api/chat/artifacts/export',
}

export enum WORKERS {
    Chat = 'hi-chat',
    // Services = 'services',
}

export enum CHAT_EP {
    ChatAction = '/chat',
    IntakeAction = '/intake',
    SummarizeAction = '/summarize',
    ApproveAction = '/artifacts/approve',
    RejectAction = '/artifacts/reject',
    ImportAction = '/artifacts/import',
    UploadAction = '/artifacts/upload',
    PresignAction = '/artifacts/upload/presign',
    ConfirmAction = '/artifacts/upload/confirm',
    ExportAction = '/artifacts/export',
}
