import { withAuth } from '@/lib/api/auth-guard';
import { handleListResources } from '@/lib/artifacts/handlers';

export const GET = withAuth(async (req, user) => {
    return await handleListResources(req, user);
});
