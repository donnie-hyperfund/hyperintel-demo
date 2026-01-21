export interface ClerkUser {
    userId: string;
    sessionId: string | null;
    sessionClaims: Record<string, unknown> | null;
}

// TODO these interfaces are specific to webhook
export interface ClerkEmailAddress {
    id: string;
    email_address: string;
    verification?: {
        status: 'verified' | 'unverified';
    };
}

export interface ClerkUserData {
    id: string;
    primary_email_address_id: string;
    email_addresses: ClerkEmailAddress[];
    first_name: string | null;
    last_name: string | null;
}

export type ClerkWebhookEventType = 'user.created' | 'user.updated' | 'user.deleted';

export interface ClerkWebhookEvent {
    type: ClerkWebhookEventType;
    data: ClerkUserData;
}
