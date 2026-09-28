import { beforeEach, describe, expect, it } from 'vitest'
import { type ConnectionStatus, TerminalConnection, terminalUrl } from './connection.ts'
import { FakeSocket } from './fakeSocket.ts'

function connect() {
  const output: Uint8Array[] = []
  const statuses: ConnectionStatus[] = []
  const connection = new TerminalConnection(
    'ws://test/ws/labs/abc/terminal',
    { cols: 80, rows: 24 },
    { onOutput: (data) => output.push(data), onStatus: (status) => statuses.push(status) },
    FakeSocket.factory,
  )
  return { connection, socket: FakeSocket.last(), output, statuses }
}

beforeEach(() => {
  FakeSocket.instances = []
})

describe('terminalUrl', () => {
  it('uses the page origin and a secure scheme on https', () => {
    expect(terminalUrl('abc', { protocol: 'http:', host: 'localhost:5173' } as Location)).toBe(
      'ws://localhost:5173/ws/labs/abc/terminal',
    )
    expect(terminalUrl('a/b', { protocol: 'https:', host: 'lab.test' } as Location)).toBe(
      'wss://lab.test/ws/labs/a%2Fb/terminal',
    )
  })
})

describe('TerminalConnection', () => {
  it('sends init with the terminal size when the socket opens', () => {
    const { socket, statuses } = connect()
    expect(socket.binaryType).toBe('arraybuffer')
    expect(statuses).toEqual([{ state: 'connecting' }])

    socket.open()

    expect(socket.sent).toEqual([JSON.stringify({ type: 'init', cols: 80, rows: 24 })])
  })

  it('reports connected once the server is ready', () => {
    const { socket, statuses } = connect()
    socket.ready()
    expect(statuses.at(-1)).toEqual({ state: 'connected' })
  })

  it('sends typed input as bytes, only after ready', () => {
    const { connection, socket } = connect()
    socket.open()
    connection.send('ignored')
    socket.receive(JSON.stringify({ type: 'ready' }))

    connection.send('ls -la\r\x03é')

    expect(socket.sent.slice(1)).toEqual([new TextEncoder().encode('ls -la\r\x03é')])
  })

  it('delivers binary output as bytes', () => {
    const { socket, output } = connect()
    socket.ready()
    socket.receive(new TextEncoder().encode('/home/student\r\n').buffer)

    expect(new TextDecoder().decode(output[0])).toBe('/home/student\r\n')
  })

  it('sends resize as a control message', () => {
    const { connection, socket } = connect()
    socket.ready()
    connection.resize({ cols: 120, rows: 32 })

    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: 'resize', cols: 120, rows: 32 }))
  })

  it('sends only the protocol fields, whatever the size object carries', () => {
    const { connection, socket } = connect()
    socket.ready()
    const size = { cols: 120, rows: 32, pixelWidth: 960 }

    connection.resize(size)

    expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({ type: 'resize', cols: 120, rows: 32 })
  })

  it.each([
    [4404, 'Laboratório indisponível.'],
    [4409, 'O terminal foi aberto em outra aba.'],
    [1011, 'O terminal parou inesperadamente.'],
    [1006, 'A conexão com o laboratório caiu.'],
  ])('explains close code %i', (code, reason) => {
    const { socket, statuses } = connect()
    socket.ready()
    socket.serverClose(code)
    expect(statuses.at(-1)).toEqual({ state: 'closed', reason })
  })

  it('reports the shell exit code', () => {
    const { socket, statuses } = connect()
    socket.ready()
    socket.receive(JSON.stringify({ type: 'exit', code: 2 }))
    socket.serverClose(4000)

    expect(statuses.at(-1)).toEqual({
      state: 'closed',
      reason: 'A sessão do shell terminou (código 2).',
    })
  })

  it('closes the socket normally and reports it once', () => {
    const { connection, socket, statuses } = connect()
    socket.ready()

    connection.close()
    connection.close()
    socket.serverClose(1000)

    expect(socket.closedWith).toBe(1000)
    expect(statuses.filter((status) => status.state === 'closed')).toHaveLength(1)
  })

  it('ignores input and resize once closed', () => {
    const { connection, socket } = connect()
    socket.ready()
    socket.serverClose(1006)
    const sent = socket.sent.length

    connection.send('ls\r')
    connection.resize({ cols: 100, rows: 30 })

    expect(socket.sent).toHaveLength(sent)
  })
})
