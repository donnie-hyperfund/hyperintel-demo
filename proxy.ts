import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { type NextRequest, NextResponse } from 'next/server';
import { CURRENT_PROJECT_COOKIE_NAME, parseProjectCookie } from '@/lib/cookies/project';
import { ChatEntity } from '@/lib/orm/entities/chats/chat.entity';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';

const isPublicRoute = createRouteMatcher(['/sign-in(.*)', '/sign-up(.*)', '/api/webhooks(.*)']);

/** Routes that any authenticated user can visit freely (no project cookie required). */
const isBrowsableRoute = createRouteMatcher([
    '/workspace',
    '/projects',
    '/projects/new(.*)',
    '/companies(.*)',
    '/stakeholders(.*)',
    '/select-project(.*)',
]);

/**
 * Test-only auth bypass for Playwright.
 * Only active when E2E_AUTH_BYPASS=true (set in .env.test, NEVER in .env/.env.dev/.env.prd).
 */
function getTestAuthBypass(req: NextRequest): string | null {
    if (process.env.NODE_ENV === 'production' || process.env.E2E_AUTH_BYPASS !== 'true') {
        return null;
    }
    return req.headers.get('x-test-clerk-id');
}

export default clerkMiddleware(async (auth, req) => {
    const testClerkId = getTestAuthBypass(req);

    if (!testClerkId && !isPublicRoute(req)) {
        await auth.protect();
    }

    const clerkUserId = testClerkId ?? (await auth()).userId;
    const pathname = req.nextUrl.pathname;

    if (clerkUserId && !isPublicRoute(req) && !pathname.startsWith('/api/')) {
        try {
            const { em } = await getOrm();
            const user = await em.findOne(UserEntity, { clerkId: clerkUserId });

            if (user) {
                const projectCount = await em.count(ProjectEntity, { user: user.id });
                const hasProjects = projectCount > 0;
                const browsable = isBrowsableRoute(req);

                if (!hasProjects && !browsable) {
                    return NextResponse.redirect(new URL('/workspace', req.url));
                }

                if (hasProjects && pathname === '/') {
                    const cookieValue = req.cookies.get(CURRENT_PROJECT_COOKIE_NAME)?.value;
                    const parsedCookie = parseProjectCookie(cookieValue);

                    let validProjectId: string | null = null;
                    if (parsedCookie && parsedCookie.userId === clerkUserId) {
                        const project = await em.findOne(ProjectEntity, {
                            id: parsedCookie.projectId,
                            user: user.id,
                        });
                        if (project) validProjectId = parsedCookie.projectId;
                    }

                    if (!validProjectId) {
                        return NextResponse.redirect(new URL('/workspace', req.url));
                    }

                    const lastChat = await em.findOne(
                        ChatEntity,
                        { project: validProjectId },
                        { orderBy: { phase_index: 'desc' } },
                    );
                    const target = lastChat ? `/${validProjectId}/${lastChat.id}` : `/${validProjectId}`;
                    return NextResponse.redirect(new URL(target, req.url));
                }
            }
        } catch (error) {
            console.error('Error checking user projects:', error);
        }
    }

    if (!clerkUserId && pathname === '/') {
        return NextResponse.redirect(new URL('/workspace', req.url));
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
