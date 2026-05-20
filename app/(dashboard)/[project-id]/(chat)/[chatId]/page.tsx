type ChatPageProps = PageProps<'/[project-id]/[chatId]'>;

export default async function ChatPage({ params }: ChatPageProps) {
    await params;

    return null;
}
