import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/api/webhooks(.*)']);
const isOnboardingRoute = createRouteMatcher(['/new-project(.*)']);

export default clerkMiddleware(async (auth, req) => {
    if (!isPublicRoute(req)) {
        await auth.protect();
    }

    const { userId } = await auth();
    const pathname = req.nextUrl.pathname;

    if (userId && !isPublicRoute(req) && !pathname.startsWith('/api/')) {
        try {
            const { em } = await getOrm();
            const user = await em.findOne(UserEntity, { clerkId: userId });

            if (user) {
                const projectCount = await em.count(ProjectEntity, { user: user.id });
                const hasProjects = projectCount > 0;

                const isOnOnboardingPage = isOnboardingRoute(req);

                // Redirect to onboarding if user has no projects and not already on onboarding page
                if (!hasProjects && !isOnOnboardingPage) {
                    const url = new URL('/new-project', req.url);
                    return NextResponse.redirect(url);
                }
            }
        } catch (error) {
            console.error('Error checking user projects:', error);
            // Continue without redirect on error
        }
    }

    return NextResponse.next();
});

export const config = {
    matcher: [
        // Skip Next.js internals and all static files, unless found in search params
        '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
        // Always run for API routes
        '/(api|trpc)(.*)',
    ],
};
