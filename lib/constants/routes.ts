export enum WORKERS_LOCAL_ENDPOINTS {
    ChatAction = '/api/chat/handler',
    SummarizeAction = '/api/chat/summarize',
    ApproveAction = '/api/chat/artifacts/approve',
    RejectAction = '/api/chat/artifacts/reject',
    UploadAction = '/api/chat/artifacts/upload',
    ExportAction = '/api/chat/artifacts/export',
}

export enum WORKERS {
    Chat = 'hi-chat',
    // Services = 'services',
}

export enum CHAT_EP {
    ChatAction = '/chat',
    SummarizeAction = '/summarize',
    ApproveAction = '/artifacts/approve',
    RejectAction = '/artifacts/reject',
    UploadAction = '/artifacts/upload',
    ExportAction = '/artifacts/export',
}
