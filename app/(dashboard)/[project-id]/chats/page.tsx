'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChatList } from './_components/chat-list';

type ChatsPageParams = PageParams<'/[project-id]'>;

export default function ChatsPage() {
    const { 'project-id': projectId } = useParams<ChatsPageParams>();
    const [isEmpty, setIsEmpty] = useState(true);

    return (
        <div className="flex h-full w-full flex-col items-center overflow-y-auto px-4 py-12">
            <div className="max-w-4xl w-full">
                <div className="mb-8 flex shrink-0 items-center justify-between">
                    <h1 className="text-2xl font-semibold">Phases</h1>
                    {!isEmpty && (
                        <Button asChild size="sm">
                            <Link href={projectId ? `/${projectId}?new=true` : '#'}>
                                <Plus className="size-4 opacity-75" />
                                New Phase
                            </Link>
                        </Button>
                    )}
                </div>

                <ChatList onEmptyChange={setIsEmpty} />
            </div>
        </div>
    );
}
