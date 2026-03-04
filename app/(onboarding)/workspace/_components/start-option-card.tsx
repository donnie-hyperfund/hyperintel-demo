'use client';

import { ArrowRight, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export type StartOption = {
    title: string;
    description: string;
    href: string;
    listHref: string;
    cta: string;
    icon: LucideIcon;
    toneClassName: string;
    helperText: string;
    itemCount: number;
};

export function StartOptionCard({ option }: { option: StartOption }) {
    const Icon = option.icon;

    return (
        <Card
            className={cn(
                'relative overflow-hidden border-neutral-800 bg-linear-to-b to-neutral-950',
                option.toneClassName,
            )}
        >
            <CardHeader className="space-y-4">
                <div className="flex items-start justify-between">
                    <div className="rounded-xl border border-neutral-700 bg-neutral-900/70 p-2.5">
                        <Icon className="size-4 text-neutral-100" />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <CardTitle className="text-xl">{option.title}</CardTitle>
                    <CardDescription className="min-h-10 text-neutral-400 leading-relaxed">
                        {option.description}
                    </CardDescription>
                </div>
                <p className="text-neutral-300 text-sm leading-relaxed">{option.helperText}</p>
            </CardHeader>
            <CardFooter className="flex-col gap-2">
                <Button asChild className="w-full justify-between" size="lg">
                    <Link href={option.href}>
                        {option.cta}
                        <ArrowRight className="size-4" />
                    </Link>
                </Button>
                {option.itemCount > 0 && (
                    <Button asChild variant="ghost" className="w-full text-neutral-400" size="sm">
                        <Link href={option.listHref}>View all</Link>
                    </Button>
                )}
            </CardFooter>
        </Card>
    );
}
