import 'server-only';

import { wrap } from '@mikro-orm/core';
import { ProjectEntity } from '@/lib/orm/entities/projects/project.entity';
import type { UserEntity } from '@/lib/orm/entities/users/user.entity';
import { getOrm } from '@/lib/orm/orm';
import type { ProjectDto } from '@/lib/schema/project';

export async function fetchProject(projectId: string, user: UserEntity): Promise<ProjectDto | null> {
    const { em } = await getOrm();
    const project = await em.findOne(ProjectEntity, { id: projectId, user: { id: user.id }, archived_at: null });
    if (!project) return null;
    return wrap(project).toJSON() as ProjectDto;
}
