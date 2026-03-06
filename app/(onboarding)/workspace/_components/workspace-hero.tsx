'use client';

import { Sparkles } from 'lucide-react';
import { motion } from 'motion/react';

export function WorkspaceHero() {
    return (
        <div className="relative overflow-hidden rounded-3xl border border-neutral-800 bg-neutral-900/60 px-6 py-8 shadow-xl backdrop-blur md:px-10 md:py-12">
            <div className="-right-12 -top-20 absolute h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
            <div className="-left-16 bottom-0 absolute h-48 w-48 rounded-full bg-sky-400/10 blur-3xl" />

            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="relative z-10 space-y-4"
            >
                <div className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-950/70 px-3 py-1.5 text-neutral-300 text-xs uppercase tracking-[0.14em]">
                    <Sparkles className="size-3.5 text-emerald-300" />
                    Workspace
                </div>
                <div className="space-y-3">
                    <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Your workspace</h1>
                    <p className="max-w-3xl text-neutral-400 text-sm leading-relaxed md:text-base">
                        Create new projects, build company profiles, or map stakeholder personas. Profiles are saved as
                        reusable resources you can import into any project.
                    </p>
                </div>
            </motion.div>
        </div>
    );
}
