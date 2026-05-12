import { WebsocketClient } from './base';
import { DirectWebsocketClient } from './direct';
import { SharedWebsocketClient } from './shared';

export { WebsocketClient } from './base';
export { DirectWebsocketClient } from './direct';
export { useWebsocket, WebsocketProvider } from './provider';
export { SharedWebsocketClient } from './shared';

/** Create a WebSocket client. Pass `{ shared: true }` for multi-tab shared socket. */
export function createWebsocketClient(url: string, opts?: { shared?: boolean }): WebsocketClient {
    if (opts?.shared) return new SharedWebsocketClient(url);
    return new DirectWebsocketClient(url);
}
