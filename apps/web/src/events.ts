type Handler = (data: any) => void;

const handlers = new Map<string, Set<Handler>>();
let source: EventSource | null = null;

function connect() {
  if (source) return;
  source = new EventSource("/api/events");
  for (const event of handlers.keys()) attach(event);
}

function attach(event: string) {
  source?.addEventListener(event, (e) => {
    const data = JSON.parse((e as MessageEvent).data);
    for (const handler of handlers.get(event) ?? []) handler(data);
  });
}

/** Subscribes to a server-sent event (`ws:data`, `ws:sessions`, `ws:chat`). */
export function onServerEvent(event: string, handler: Handler) {
  if (!handlers.has(event)) {
    handlers.set(event, new Set());
    attach(event);
  }
  handlers.get(event)!.add(handler);
  connect();
  return () => void handlers.get(event)!.delete(handler);
}
