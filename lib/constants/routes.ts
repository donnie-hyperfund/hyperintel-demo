export enum WORKERS_LOCAL_ENDPOINTS {
    ChatAction = '/api/chat/handler',
    IntakeAction = '/api/intake/handler',
    SummarizeAction = '/api/chat/summarize',
    ApproveAction = '/api/chat/artifacts/approve',
    RejectAction = '/api/chat/artifacts/reject',
    RestoreAction = '/api/chat/artifacts/restore',
    ImportAction = '/api/chat/artifacts/import',
    UploadAction = '/api/chat/artifacts/upload',
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
    RestoreAction = '/artifacts/restore',
    ImportAction = '/artifacts/import',
    UploadAction = '/artifacts/upload',
    ExportAction = '/artifacts/export',
}
