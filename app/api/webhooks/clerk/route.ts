import type { EntityManager } from '@mikro-orm/postgresql';
import { headers } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { Webhook } from 'svix';
import { backendEnv } from '@/app/api/env';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import type { ClerkEmailAddress, ClerkUserData, ClerkWebhookEvent } from '@/lib/types/clerk';

function getPrimaryEmail(emailAddresses: ClerkEmailAddress[], primaryEmailId: string): string | null {
    const primaryEmail = emailAddresses.find((email) => email.id === primaryEmailId);
    return primaryEmail?.email_address || emailAddresses[0]?.email_address || null;
}

function isEmailVerified(emailAddresses: ClerkEmailAddress[]): boolean {
    return emailAddresses.some((email) => email.verification?.status === 'verified');
}

function formatUserName(firstName: string | null, lastName: string | null): string | null {
    if (firstName && lastName) {
        return `${firstName} ${lastName}`;
    }
    return firstName || lastName || null;
}

async function handleUserCreatedOrUpdated(data: ClerkUserData, em: EntityManager): Promise<NextResponse> {
    const primaryEmail = getPrimaryEmail(data.email_addresses, data.primary_email_address_id);

    if (!primaryEmail) {
        return NextResponse.json({ error: 'No email address found' }, { status: 400 });
    }

    let user = await em.findOne(UserEntity, { clerkId: data.id });

    if (!user) {
        user = await em.findOne(UserEntity, { email: primaryEmail });
    }

    const emailConfirmed = isEmailVerified(data.email_addresses);
    const name = formatUserName(data.first_name, data.last_name);

    if (user) {
        user.clerkId = data.id;
        user.email = primaryEmail;
        user.name = name;
        user.emailConfirmed = emailConfirmed;
    } else {
        user = em.create(UserEntity, {
            clerkId: data.id,
            email: primaryEmail,
            name,
            emailConfirmed,
        });
    }

    await em.persistAndFlush(user);

    return NextResponse.json({
        message: 'User synchronized successfully',
        userId: user.id,
    });
}

async function handleUserDeleted(clerkId: string, em: EntityManager): Promise<NextResponse> {
    const user = await em.findOne(UserEntity, { clerkId });

    if (user) {
        await em.removeAndFlush(user);
    }

    return NextResponse.json({
        message: 'User deleted successfully',
    });
}

export async function POST(req: NextRequest) {
    try {
        const headerPayload = await headers();
        const svixId = headerPayload.get('svix-id');
        const svixTimestamp = headerPayload.get('svix-timestamp');
        const svixSignature = headerPayload.get('svix-signature');

        if (!svixId || !svixTimestamp || !svixSignature) {
            return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
        }

        const payload = await req.json();
        const body = JSON.stringify(payload);

        const wh = new Webhook(backendEnv.CLERK_WEBHOOK_SECRET);

        let evt: ClerkWebhookEvent;

        try {
            evt = wh.verify(body, {
                'svix-id': svixId,
                'svix-timestamp': svixTimestamp,
                'svix-signature': svixSignature,
            }) as ClerkWebhookEvent;
        } catch (err) {
            console.error('Error verifying webhook:', err);
            return NextResponse.json({ error: 'Error verifying webhook' }, { status: 400 });
        }

        const { em } = await getOrm();

        switch (evt.type) {
            case 'user.created':
            case 'user.updated':
                return await handleUserCreatedOrUpdated(evt.data, em);

            case 'user.deleted':
                return await handleUserDeleted(evt.data.id, em);

            default:
                console.log(`Unhandled event type: ${evt.type}`);
                return NextResponse.json({ message: 'Event type not handled' }, { status: 200 });
        }
    } catch (error) {
        console.error('Error processing webhook:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
