// Client side of the terminal WebSocket protocol (see docs/terminal.md in linux-lab-api).
// Binary frames carry terminal bytes both ways; text frames carry JSON control messages.

export type TerminalSize = { cols: number; rows: number }

export type ConnectionState = 'connecting' | 'connected' | 'closed'

export type ConnectionStatus = {
  state: ConnectionState
  // Why the connection ended, in the interface language. Absent while open.
  reason?: string
}

export type ConnectionHandlers = {
  onOutput: (data: Uint8Array) => void
  onStatus: (status: ConnectionStatus) => void
}

export type SocketFactory = (url: string) => WebSocket

type ServerMessage =
  | { type: 'ready' }
  | { type: 'exit'; code: number | null }
  | { type: 'error'; message: string }

const closeReasons: Record<number, string> = {
  1000: 'Conexão encerrada.',
  1008: 'Mensagem recusada pelo servidor.',
  1009: 'Mensagem grande demais.',
  1011: 'O terminal parou inesperadamente.',
  4000: 'A sessão do shell terminou.',
  4404: 'Laboratório indisponível.',
  4409: 'O terminal foi aberto em outra aba.',
}

export function terminalUrl(labId: string, location: Location = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}/ws/labs/${encodeURIComponent(labId)}/terminal`
}

export class TerminalConnection {
  private readonly socket: WebSocket
  private readonly encoder = new TextEncoder()
  private state: ConnectionState = 'connecting'
  private exitCode: number | null | undefined

  constructor(
    url: string,
    size: TerminalSize,
    private readonly handlers: ConnectionHandlers,
    socketFactory: SocketFactory = (target) => new WebSocket(target),
  ) {
    this.socket = socketFactory(url)
    this.socket.binaryType = 'arraybuffer'
    this.socket.onopen = () => {
      this.socket.send(JSON.stringify({ type: 'init', cols: size.cols, rows: size.rows }))
    }
    this.socket.onmessage = (event: MessageEvent<ArrayBuffer | string>) => this.receive(event.data)
    this.socket.onclose = (event: CloseEvent) => this.closed(event.code)
    this.handlers.onStatus({ state: 'connecting' })
  }

  send(data: string): void {
    if (this.state === 'connected') {
      this.socket.send(this.encoder.encode(data))
    }
  }

  resize(size: TerminalSize): void {
    if (this.state === 'connected') {
      this.socket.send(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }))
    }
  }

  close(): void {
    if (this.state !== 'closed') {
      this.socket.close(1000)
    }
  }

  private receive(data: ArrayBuffer | string): void {
    if (typeof data !== 'string') {
      this.handlers.onOutput(new Uint8Array(data))
      return
    }
    const message = JSON.parse(data) as ServerMessage
    if (message.type === 'ready') {
      this.state = 'connected'
      this.handlers.onStatus({ state: 'connected' })
    } else if (message.type === 'exit') {
      this.exitCode = message.code
    }
  }

  private closed(code: number): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    let reason = closeReasons[code] ?? 'A conexão com o laboratório caiu.'
    if (code === 4000 && this.exitCode !== undefined && this.exitCode !== null) {
      reason = `A sessão do shell terminou (código ${this.exitCode}).`
    }
    this.handlers.onStatus({ state: 'closed', reason })
  }
}
