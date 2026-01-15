# HYPERINTEL™ Demo


A modern, dual-panel chat interface demo built with Next.js, featuring a split-screen conversation view and comprehensive UI components.

## Features

- **Dual Chat Panels**: Side-by-side conversation interface with resizable panels
- **Modern UI**: Built with shadcn/ui components and Radix UI primitives
- **Responsive Design**: Adaptive layout with collapsible sidebar
- **Theme Support**: Dark and light mode support via `next-themes`
- **Type-Safe**: Full TypeScript implementation
- **Component Library**: Extensive collection of reusable UI components

## Tech Stack

- **Framework**: Next.js 16
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4
- **UI Components**: shadcn/ui (Radix UI)
- **Icons**: Lucide React
- **Package Manager**: pnpm
- **Form Handling**: React Hook Form + Zod

## Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (install via `npm install -g pnpm`)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd hyperintel-demo
```

2. Install dependencies:
```bash
pnpm install
```

3. Run the development server:
```bash
pnpm dev
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Available Scripts

- `pnpm dev` - Start the development server
- `pnpm build` - Build the application for production
- `pnpm start` - Start the production server
- `pnpm lint` - Run ESLint

## Project Structure

```
hyperintel-demo/
├── app/                    # Next.js app directory
│   ├── api/               # API routes
│   │   └── chat/         # Chat API endpoint
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── chat-interface.tsx # Main chat interface
│   └── theme-provider.tsx  # Theme context provider
├── hooks/                # Custom React hooks
├── lib/                  # Utility functions
├── public/               # Static assets
└── styles/               # Global styles
```

## Features Overview

### Chat Interface

The main chat interface (`components/chat-interface.tsx`) includes:

- **Sidebar Navigation**: Collapsible sidebar with navigation items (Chats, Artifacts, Projects, Code)
- **Dual Panels**: Two independent chat panels that can be resized
- **Message Display**: User and assistant messages with distinct styling
- **Loading States**: Animated loading indicators during API calls
- **Input Area**: Message input with send functionality

### API Route

The chat API route (`app/api/chat/route.ts`) currently simulates AI responses with different responses for each panel. This can be extended to integrate with actual AI services.

## Development

### Adding New Components

This project uses shadcn/ui components. To add a new component:

```bash
npx shadcn@latest add [component-name]
```

### Styling

The project uses Tailwind CSS with custom theme variables. Theme configuration can be found in `app/globals.css` and `styles/globals.css`.

### TypeScript

The project is fully typed. Ensure all new code includes proper TypeScript types.

## License

Private project - All rights reserved.
