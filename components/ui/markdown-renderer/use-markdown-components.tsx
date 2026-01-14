import { Tooltip, TooltipContent, TooltipTrigger } from '@radix-ui/react-tooltip';
import { ExternalLink, Info, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Components } from 'react-markdown';
import { cn } from '@/lib/utils';

type UseMarkdownComponentsParams = {
    id?: string;
};

export const useMarkdownComponents = ({ id }: UseMarkdownComponentsParams) => {
    // TODO stupid.. make it stable fallback to full reta... I mean random
    const [hoveredCitation, setHoveredCitation] = useState<string | null>(null);
    const [randId, setRandomId] = useState<string>(id ?? `${Math.round(Math.random() * 10000)}`);

    const components = useMemo(() => {
        return {
            // Custom renderer for paragraphs (chat-like bubbles)
            // p: ({ children }) => (
            //   <p className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg mb-4">
            //     {children}
            //   </p>
            // ),
            a: ({ children, id, ...props }) => {
                if (id) {
                    id = `_${randId}__${id}`;
                }
                if (props.href && props.href.startsWith('#')) {
                    //if(scrollToId){

                    //    return (
                    //        <span
                    //            id={id}
                    //            onClick={() =>
                    //                scrollToId(
                    //                    `_${randId}__${props.href!.slice(1)}`,
                    //                )
                    //            }
                    //            className="cursor-pointer"
                    //        >{children}</span>
                    //    );
                    //} else {
                    return (
                        <a id={id} href={`#_${randId}__${props.href!.slice(1)}`}>
                            {children}
                        </a>
                    );

                    //}
                }
                return (
                    <a id={id} {...props} target="_blank" rel="noopener noreferrer">
                        {children}
                    </a>
                );
            },
            // TODO: Add separate styles for logo images and remove the square aspect ratio
            img: ({ src, alt, className, ...props }) => {
                return (
                    <img
                        src={src}
                        alt={alt}
                        {...props}
                        className={cn('aspect-square object-cover max-w-[300px] rounded-lg w-full', className)}
                    />
                );
            },
            li: ({ children, id, ...props }) => {
                if (id) {
                    id = `_${randId}__${id}`;
                }
                return (
                    <li id={id} {...props}>
                        {children}
                    </li>
                );
            },

            // Custom sup for citations: Interactive button with icon and tooltip
            /*
                props.className?.includes("grouped") &&
                  "bg-blue-100 rounded px-1",*/
            sup: ({ children, ...props }) => {
                const isCitation = props.id?.startsWith('user-content-fnref-');
                if (!isCitation) return <sup {...props}>{children}</sup>;

                return (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                type="button"
                                className={`inline-flex items-center text-blue-500 hover:text-blue-700 focus:outline-none bg-blue-100 rounded px-1`}
                                onMouseEnter={() => setHoveredCitation(props.id || null)}
                                onMouseLeave={() => setHoveredCitation(null)}
                            >
                                <Info size={12} className="mr-1" /> {/* Icon */}
                                {children}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>
                            {/* Fetch citation details dynamically or from markdown */}
                            <p>Citation details: {hoveredCitation ? `Source for ${hoveredCitation}` : 'Loading...'}</p>
                            <a href="#footnote-section" className="flex items-center">
                                View full <ExternalLink size={12} className="ml-1" />
                            </a>
                        </TooltipContent>
                    </Tooltip>
                );
            },

            // Render footnote section as grouped list
            section: ({ className, children, ...props }) => {
                if (className?.includes('footnotes')) {
                    return (
                        <section {...props} className="mt-8 border-t pt-4 text-sm">
                            {children}
                        </section>
                    );
                }
                return (
                    <section {...props} className={className}>
                        {children}
                    </section>
                );
            },

            // Replace hourglass spinner placeholder with spinner component
            span: ({ children, className, ...props }) => {
                if (className === 'hourglass-spinner-placeholder') {
                    return <Loader2 className="h-4 w-4 animate-spin inline-block align-middle" />;
                }
                return (
                    <span className={className} {...props}>
                        {children}
                    </span>
                );
            },
            // Wrap tables in a scrollable container
            table: ({ children, ...props }) => {
                return (
                    <div className="prose-table-wrapper">
                        <table {...props}>{children}</table>
                    </div>
                );
            },
            code: ({ className, children, ...props }) => {
                const isInline = !className?.includes('language-');
                if (isInline) {
                    return (
                        <code className={cn('px-1 py-0.5 rounded bg-neutral-900 text-sm', className)} {...props}>
                            {children}
                        </code>
                    );
                }
                return (
                    <code className={className} {...props}>
                        {children}
                    </code>
                );
            },
            pre: ({ children, className, ...props }) => {
                return (
                    <div className="overflow-x-auto w-full mb-3 p-2 min-w-0 max-w-full rounded-4 bg-neutral-900 scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent hover:scrollbar-thumb-gray-500 scrollbar-thumb-rounded-md">
                        <pre
                            className={cn('w-full min-w-0 max-w-full overflow-x-auto p-4 bg-transparent', className)}
                            {...props}
                        >
                            {children}
                        </pre>
                    </div>
                );
            },
        } satisfies Components;
    }, [id]);

    return components;
};
