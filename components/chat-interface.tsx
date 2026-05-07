'use client';

import { Code, FileCode, Layers, Loader2, MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { typedFetch } from '@/lib/api/client/fetch';
import { cn } from '@/lib/utils';

type Message = {
    role: 'user' | 'assistant';
    content: string;
};

type Conversation = {
    id: string;
    messages: Message[];
    isLoading: boolean;
};

const navItems = [
    { icon: MessageSquare, label: 'Chats', active: true },
    { icon: Layers, label: 'Artifacts' },
    { icon: FileCode, label: 'Projects' },
    { icon: Code, label: 'Code' },
];

const projectNames = ['Project Name Goes Here', 'Project Name Goes Here', 'Project Name Goes Here'];

export default function ChatInterface() {
    const [sidebarExpanded, setSidebarExpanded] = useState(false);
    const [username, setUsername] = useState('Username');
    const [inputValue, setInputValue] = useState('');
    const [leftPanelWidth, setLeftPanelWidth] = useState(50); // percentage
    const [isResizing, setIsResizing] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const handleMouseDown = () => {
        setIsResizing(true);
    };

    const handleMouseMove = (e: MouseEvent) => {
        if (!isResizing || !containerRef.current) return;

        const containerRect = containerRef.current.getBoundingClientRect();
        const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;

        // Constrain between 20% and 80%
        if (newLeftWidth >= 20 && newLeftWidth <= 80) {
            setLeftPanelWidth(newLeftWidth);
        }
    };

    const handleMouseUp = () => {
        setIsResizing(false);
    };

    useEffect(() => {
        if (isResizing) {
            document.addEventListener('mousemove', handleMouseMove as any);
            document.addEventListener('mouseup', handleMouseUp);
        } else {
            document.removeEventListener('mousemove', handleMouseMove as any);
            document.removeEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove as any);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const [conversations, setConversations] = useState<Conversation[]>([
        {
            id: 'left',
            messages: [],
            isLoading: false,
        },
        {
            id: 'right',
            messages: [],
            isLoading: false,
        },
    ]);

    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const userMessage: Message = {
            role: 'user',
            content: inputValue,
        };

        // Add user message to both conversations
        setConversations((prev) =>
            prev.map((conv) => ({
                ...conv,
                messages: [...conv.messages, userMessage],
                isLoading: true,
            })),
        );

        setInputValue('');

        // Simulate AI responses for both panels
        try {
            const responses = await Promise.all([
                typedFetch<{ message: string }, { message: string }>('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [...conversations[0].messages, userMessage],
                        conversationId: 'left',
                    }),
                }),
                typedFetch<{ message: string }, { message: string }>('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        messages: [...conversations[1].messages, userMessage],
                        conversationId: 'right',
                    }),
                }),
            ]);

            const [leftData, rightData] = await Promise.all([responses[0].json(), responses[1].json()]);

            setConversations((prev) => [
                {
                    ...prev[0],
                    messages: [...prev[0].messages, { role: 'assistant', content: leftData.message }],
                    isLoading: false,
                },
                {
                    ...prev[1],
                    messages: [...prev[1].messages, { role: 'assistant', content: rightData.message }],
                    isLoading: false,
                },
            ]);
        } catch (error) {
            console.error('Error fetching responses:', error);
            setConversations((prev) =>
                prev.map((conv) => ({
                    ...conv,
                    isLoading: false,
                })),
            );
        }
    };

    return (
        <div className="flex h-screen bg-background text-foreground">
            {/* Sidebar */}
            <aside
                className={cn(
                    'bg-sidebar border-r border-sidebar-border flex flex-col py-6 transition-all duration-300 ease-in-out',
                    sidebarExpanded ? 'w-64 px-4' : 'w-16 px-3',
                )}
                onMouseEnter={() => setSidebarExpanded(true)}
                onMouseLeave={() => setSidebarExpanded(false)}
            >
                <div
                    className={cn(
                        'flex items-center mb-6 transition-all duration-300',
                        sidebarExpanded ? 'justify-start gap-3 px-2' : 'justify-center',
                    )}
                >
                    <div className="flex items-center justify-center w-10 h-10 bg-primary rounded-lg flex-shrink-0">
                        <span className="text-sm font-bold text-primary-foreground">H</span>
                    </div>
                    {sidebarExpanded && (
                        <span className="text-lg font-semibold whitespace-nowrap">
                            HYPER<span className="text-primary">INTEL</span>
                            <sup className="text-[10px] align-super">™</sup>
                        </span>
                    )}
                </div>

                <nav className="flex flex-col gap-2 flex-1">
                    {navItems.map((item) => (
                        <button
                            key={item.label}
                            className={cn(
                                'flex items-center rounded-lg transition-colors h-10',
                                sidebarExpanded ? 'gap-3 px-3 justify-start' : 'justify-center',
                                item.active
                                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50',
                            )}
                            title={item.label}
                        >
                            <item.icon className="w-5 h-5 flex-shrink-0" />
                            {sidebarExpanded && <span className="text-sm">{item.label}</span>}
                        </button>
                    ))}
                </nav>

                {sidebarExpanded && (
                    <div className="mb-4 space-y-2">
                        {projectNames.map((name, idx) => (
                            <div
                                key={idx}
                                className="text-xs text-sidebar-foreground/60 px-3 py-1.5 hover:bg-sidebar-accent/30 rounded cursor-pointer transition-colors truncate"
                            >
                                {name}
                            </div>
                        ))}
                    </div>
                )}

                <div
                    className={cn(
                        'flex items-center transition-all duration-300',
                        sidebarExpanded ? 'justify-start gap-3 px-2' : 'justify-center',
                    )}
                >
                    <div className="flex items-center justify-center w-10 h-10 bg-muted rounded-full text-xs font-medium flex-shrink-0">
                        {username.charAt(0).toUpperCase()}
                    </div>
                    {sidebarExpanded && <span className="text-sm truncate">{username}</span>}
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col">
                {/* Header */}
                <header className="h-14 border-b border-border flex items-center px-6 gap-4">
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-semibold">
                            HYPER<span className="text-primary">INTEL</span>
                            <sup className="text-[10px] align-super">™</sup>
                        </span>
                    </div>
                    <div className="flex items-center gap-2 ml-auto">
                        <div className="text-sm text-muted-foreground">Project Name / Chat Name</div>
                    </div>
                </header>

                {/* Chat Panels */}
                <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
                    {/* Left Panel */}
                    <div
                        className="bg-card flex flex-col border-r border-border"
                        style={{ width: `${leftPanelWidth}%` }}
                    >
                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {conversations[0].messages.length === 0 && (
                                <div className="h-full flex items-center justify-center">
                                    <div className="text-center space-y-2">
                                        <div className="text-4xl">💬</div>
                                        <p className="text-muted-foreground">Start a conversation</p>
                                    </div>
                                </div>
                            )}

                            {conversations[0].messages.map((message, msgIndex) => (
                                <div
                                    key={msgIndex}
                                    className={cn(
                                        'flex gap-3',
                                        message.role === 'user' ? 'justify-end' : 'justify-start',
                                    )}
                                >
                                    {message.role === 'assistant' && (
                                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                            <span className="text-xs font-bold text-primary-foreground">AI</span>
                                        </div>
                                    )}
                                    <div
                                        className={cn(
                                            'max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed',
                                            message.role === 'user'
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted text-foreground',
                                        )}
                                    >
                                        {message.content}
                                    </div>
                                    {message.role === 'user' && (
                                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                            <span className="text-xs font-medium">
                                                {username.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {conversations[0].isLoading && (
                                <div className="flex gap-3 justify-start">
                                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                        <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
                                    </div>
                                    <div className="max-w-[80%] rounded-lg px-4 py-2 text-sm bg-muted">
                                        <div className="flex gap-1">
                                            <span
                                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                                style={{ animationDelay: '0ms' }}
                                            />
                                            <span
                                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                                style={{ animationDelay: '150ms' }}
                                            />
                                            <span
                                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                                style={{ animationDelay: '300ms' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Resize Handle */}
                    <div
                        className={cn(
                            'w-1 bg-border hover:bg-primary/50 cursor-col-resize transition-colors relative group',
                            isResizing && 'bg-primary',
                        )}
                        onMouseDown={handleMouseDown}
                    >
                        <div className="absolute inset-y-0 -left-1 -right-1" />
                    </div>

                    {/* Right Panel */}
                    <div className="bg-card flex flex-col flex-1" style={{ width: `${100 - leftPanelWidth}%` }}>
                        {/* Messages */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {conversations[1].messages.length === 0 && (
                                <div className="h-full flex items-center justify-center">
                                    <div className="text-center space-y-3 max-w-sm">
                                        <div className="w-16 h-16 mx-auto bg-muted rounded-lg flex items-center justify-center">
                                            <Layers className="w-8 h-8 text-muted-foreground/50" />
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-lg font-medium text-foreground">Artifact Preview</p>
                                            <p className="text-sm text-muted-foreground">
                                                Generated artifacts will appear here
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {conversations[1].messages.map((message, msgIndex) => (
                                <div
                                    key={msgIndex}
                                    className={cn(
                                        'flex gap-3',
                                        message.role === 'user' ? 'justify-end' : 'justify-start',
                                    )}
                                >
                                    {message.role === 'assistant' && (
                                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                            <span className="text-xs font-bold text-primary-foreground">AI</span>
                                        </div>
                                    )}
                                    <div
                                        className={cn(
                                            'max-w-[80%] rounded-lg px-4 py-2 text-sm leading-relaxed',
                                            message.role === 'user'
                                                ? 'bg-primary text-primary-foreground'
                                                : 'bg-muted text-foreground',
                                        )}
                                    >
                                        {message.content}
                                    </div>
                                    {message.role === 'user' && (
                                        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                                            <span className="text-xs font-medium">
                                                {username.charAt(0).toUpperCase()}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {conversations[1].isLoading && (
                                <div className="flex gap-3 justify-start">
                                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                                        <Loader2 className="w-4 h-4 text-primary-foreground animate-spin" />
                                    </div>
                                    <div className="max-w-[80%] rounded-lg px-4 py-2 text-sm bg-muted">
                                        <div className="flex gap-1">
                                            <span
                                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                                style={{ animationDelay: '0ms' }}
                                            />
                                            <span
                                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                                style={{ animationDelay: '150ms' }}
                                            />
                                            <span
                                                className="w-2 h-2 bg-foreground/40 rounded-full animate-bounce"
                                                style={{ animationDelay: '300ms' }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Input Area */}
                <div className="border-t border-border p-4">
                    <div className="max-w-4xl mx-auto flex gap-2">
                        <Input
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder="Type your message..."
                            className="flex-1 bg-muted border-0"
                        />
                        <Button onClick={handleSend} className="px-6">
                            Send
                        </Button>
                    </div>
                    <div className="max-w-4xl mx-auto mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <Input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="w-32 h-7 bg-muted border-0 text-xs"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
