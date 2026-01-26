'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ChatList } from './_components/chat-list';

export default function ChatsPage() {
    const params = useParams();
    const projectId = params?.['project-id'] as string | undefined;

    return (
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-12">
            <div className="mb-8 flex items-center justify-between">
                <h1 className="text-2xl font-semibold">Phases</h1>
                <Button asChild size="sm">
                    <Link href={projectId ? `/${projectId}` : '#'}>
                        <Plus className="size-4 opacity-75" />
                        New Phase
                    </Link>
                </Button>
            </div>

            <ChatList />
        </div>
    );
}
