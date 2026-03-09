'use client';

import { Building2, FileCode2, Users2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useFetchArtifacts } from '@/lib/api/client/hooks/use-artifacts';
import { useFetchProjects } from '@/lib/api/client/hooks/use-projects';
import { pluralize } from '@/lib/utils';
import { type StartOption, StartOptionCard } from './start-option-card';

export function StartOptionsGrid() {
    const projectsQuery = useFetchProjects({ page: 1, limit: 1 });
    const companiesQuery = useFetchArtifacts('Company Profile', { page: 1, limit: 1 });
    const stakeholdersQuery = useFetchArtifacts('Human Persona', { page: 1, limit: 1 });

    const totalProjects = projectsQuery.data?.pagination.total ?? 0;
    const companyCount = companiesQuery.data?.pagination.total ?? 0;
    const stakeholderCount = stakeholdersQuery.data?.pagination.total ?? 0;

    const options: StartOption[] = [
        {
            title: 'New project',
            description: "Start a new project. Let's go!",
            href: '/projects/new',
            listHref: '/projects',
            cta: 'Start project',
            icon: FileCode2,
            toneClassName:
                'from-emerald-500/15 via-emerald-400/10 to-transparent border-emerald-300/20 shadow-[0_0_0_1px_rgba(16,185,129,0.1),0_12px_30px_rgba(16,185,129,0.08)]',
            itemCount: totalProjects,
            helperText:
                totalProjects > 0
                    ? `You have ${pluralize(totalProjects, 'project', 'projects')}.`
                    : 'No projects yet — start your first one.',
        },
        {
            title: 'Company profile',
            description: 'Build a company profile. Create once, deploy across any project.',
            href: '/companies/new',
            listHref: '/companies',
            cta: 'New company profile',
            icon: Building2,
            toneClassName:
                'from-sky-500/15 via-sky-400/10 to-transparent border-sky-300/20 shadow-[0_0_0_1px_rgba(56,189,248,0.1),0_12px_30px_rgba(56,189,248,0.08)]',
            itemCount: companyCount,
            helperText:
                companiesQuery.isLoading || companiesQuery.error
                    ? 'Reusable across all your projects.'
                    : companyCount > 0
                      ? `${pluralize(companyCount, 'profile', 'profiles')} in your library.`
                      : 'Create one now and reuse it across projects.',
        },
        {
            title: 'Stakeholder persona',
            description: 'Create a new persona. Create once, deploy across any project.',
            href: '/stakeholders/new',
            listHref: '/stakeholders',
            cta: 'New stakeholder persona',
            icon: Users2,
            toneClassName:
                'from-amber-500/15 via-amber-400/10 to-transparent border-amber-300/20 shadow-[0_0_0_1px_rgba(245,158,11,0.1),0_12px_30px_rgba(245,158,11,0.08)]',
            itemCount: stakeholderCount,
            helperText:
                stakeholdersQuery.isLoading || stakeholdersQuery.error
                    ? 'Reusable across all your projects.'
                    : stakeholderCount > 0
                      ? `${pluralize(stakeholderCount, 'persona', 'personas')} in your library.`
                      : 'Start profiling and import into projects later.',
        },
    ];

    return (
        <motion.section
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.12, ease: 'easeOut' }}
            className="mt-6 grid gap-4 md:grid-cols-3"
        >
            {options.map((option) => (
                <StartOptionCard key={option.title} option={option} />
            ))}
        </motion.section>
    );
}
