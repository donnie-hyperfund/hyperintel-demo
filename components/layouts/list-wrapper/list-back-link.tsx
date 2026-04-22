import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';

type ListBackLinkProps = {
    href: string;
    children: React.ReactNode;
};

export function ListBackLink({ href, children }: ListBackLinkProps) {
    return (
        <Link
            href={href}
            className="inline-flex items-center gap-1 text-sm text-neutral-400 transition-colors hover:text-neutral-100"
        >
            <ChevronLeft className="size-4" />
            {children}
        </Link>
    );
}
