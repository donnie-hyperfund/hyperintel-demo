type MutatorFn = (affectedProjectId?: string) => void;

const mutators = new Set<MutatorFn>();

export function registerProjectListMutator(mutate: MutatorFn): () => void {
    mutators.add(mutate);
    return () => {
        mutators.delete(mutate);
    };
}

export function revalidateProjectInfiniteLists(affectedProjectId?: string) {
    mutators.forEach((fn) => fn(affectedProjectId));
}
