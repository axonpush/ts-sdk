import type { components } from "../schema";

type Event = components["schemas"]["Event"];

export interface SubscribeFilters {
  agentId?: string;
  eventType?: string;
  traceId?: string;
}

export interface PublishData {
  channelId: number;
  identifier: string;
  payload: Record<string, unknown>;
  agentId?: string;
  traceId?: string;
  eventType?: string;
}

type EventHandler = (event: Event) => void;

export class WebSocketClient {
  private sio: any;
  private eventHandlers: EventHandler[] = [];

  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async connect(): Promise<void> {
    let io: any;
    try {
      io = (await import("socket.io-client")).io;
    } catch {
      throw new Error(
        "WebSocket support requires socket.io-client. Install it with: bun add socket.io-client",
      );
    }

    this.sio = io(this.baseUrl, {
      path: "/socket.io",
      auth: { apiKey: this.apiKey },
      autoConnect: false,
    });

    this.sio.on("event", (data: Record<string, unknown>) => {
      for (const handler of this.eventHandlers) {
        try {
          handler(data as Event);
        } catch {}
      }
    });

    return new Promise((resolve, reject) => {
      this.sio.on("connect", () => resolve());
      this.sio.on("connect_error", (err: Error) => reject(err));
      this.sio.connect();
    });
  }

  subscribe(channelId: number, filters?: SubscribeFilters): void {
    const data: Record<string, unknown> = { channelId };
    if (filters?.agentId) data.agentId = filters.agentId;
    if (filters?.eventType) data.eventType = filters.eventType;
    if (filters?.traceId) data.traceId = filters.traceId;
    this.sio.emit("subscribe", data);
  }

  unsubscribe(channelId: number): void {
    this.sio.emit("unsubscribe", { channelId });
  }

  publish(data: PublishData): void {
    this.sio.emit("publish", data);
  }

  onEvent(handler: EventHandler): void {
    this.eventHandlers.push(handler);
  }

  async disconnect(): Promise<void> {
    this.sio?.disconnect();
  }

  async wait(): Promise<void> {
    return new Promise((resolve) => {
      this.sio.on("disconnect", () => resolve());
    });
  }
}
