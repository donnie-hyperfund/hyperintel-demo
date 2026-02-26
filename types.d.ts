/**
 * Extracts the resolved params type from a Next.js PageProps route.
 * Works with both server components (await props.params) and client components (useParams).
 *
 * @example
 * // Server component
 * export default async function Page(props: PageProps<'/[project-id]/(chat)/[chatId]'>) {
 *   const params: PageParams<'/[project-id]/(chat)/[chatId]'> = await props.params
 * }
 *
 * // Client component
 * const params = useParams<PageParams<'/[project-id]/(chat)/[chatId]'>>()
 */
type PageParams<T extends string> = Awaited<PageProps<T>['params']>;
