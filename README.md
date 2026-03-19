# Hocuspocus WebSocket Server

Real-time collaboration server for Returfs extensions using Yjs.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build

# Start production server
pnpm start
```

## Configuration

Copy `.env.example` to `.env` and configure:

```env
APP_NAME=hocuspocus
APP_PORT=1234
APP_HOST=localhost
RETURFS_API_URL=http://project.test
```

## How It Works

1. Extensions connect via WebSocket with document name and API routes
2. Server fetches initial content from Returfs API
3. Yjs synchronizes changes between all connected clients
4. Changes are periodically persisted back to the Returfs API

## Query Parameters

Extensions should connect with these query parameters:

- `resourceRoute`: API endpoint to fetch content
- `resourceUpdateRoute`: API endpoint to save content
- `apiKey`: Developer API key (for authentication)

## Architecture

```
client (Tiptap/Yjs) <--> Hocuspocus <--> Returfs API
                              |
                              v
                         Yjs CRDT
                    (conflict resolution)
```
