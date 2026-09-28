// A WebSocket stand-in for tests: records what the client sends and lets the test
// play the server's side.
export class FakeSocket {
  static instances: FakeSocket[] = []

  binaryType: BinaryType = 'blob'
  sent: (string | Uint8Array)[] = []
  closedWith: number | undefined
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  static factory = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket

  static last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1)
    if (!socket) throw new Error('no socket was created')
    return socket
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data)
  }

  close(code = 1000): void {
    this.closedWith = code
    this.serverClose(code)
  }

  open(): void {
    this.onopen?.(new Event('open'))
  }

  receive(data: string | ArrayBuffer): void {
    this.onmessage?.({ data } as MessageEvent)
  }

  ready(): void {
    this.open()
    this.receive(JSON.stringify({ type: 'ready' }))
  }

  serverClose(code: number): void {
    this.onclose?.({ code } as CloseEvent)
  }
}
