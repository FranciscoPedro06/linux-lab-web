// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { Terminal as XTerm } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSocket } from './fakeSocket.ts'
import { type Insert, type InsertResult, Terminal } from './Terminal.tsx'

// xterm.js renders to a canvas-like DOM that jsdom does not support, so the terminal
// emulator is replaced by a recorder. The connection and the component are real.
vi.mock('@xterm/xterm', () => {
  class Terminal {
    static instances: Terminal[] = []
    cols = 80
    rows = 24
    element: HTMLElement | null = null
    written: Uint8Array[] = []
    disposed = false
    focused = 0
    modes = { bracketedPasteMode: false }
    dataHandler: (data: string) => void = () => {}
    resizeHandler: (size: { cols: number; rows: number }) => void = () => {}
    constructor() {
      Terminal.instances.push(this)
    }
    loadAddon() {}
    open(element: HTMLElement) {
      this.element = element
    }
    focus() {
      this.focused += 1
    }
    // As xterm.js does: line breaks become carriage returns, and the text is wrapped
    // in bracketed paste markers when the program turned that mode on.
    paste(text: string) {
      const data = text.replace(/\r?\n/g, '\r')
      this.dataHandler(
        this.modes.bracketedPasteMode ? `\x1b[200~${data}\x1b[201~` : data,
      )
    }
    write(data: Uint8Array) {
      this.written.push(data)
    }
    dispose() {
      this.disposed = true
    }
    onData(handler: (data: string) => void) {
      this.dataHandler = handler
      return { dispose() {} }
    }
    onResize(handler: (size: { cols: number; rows: number }) => void) {
      this.resizeHandler = handler
      return { dispose() {} }
    }
  }
  return { Terminal }
})
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit() {} } }))

type RecordingTerminal = {
  element: HTMLElement | null
  focused: number
  modes: { bracketedPasteMode: boolean }
  written: Uint8Array[]
  disposed: boolean
  dataHandler: (data: string) => void
  resizeHandler: (size: { cols: number; rows: number }) => void
}

function lastTerminal(): RecordingTerminal {
  const instances = (XTerm as unknown as { instances: RecordingTerminal[] }).instances
  const terminal = instances.at(-1)
  if (!terminal) throw new Error('no terminal was created')
  return terminal
}

function renderTerminal(props: { closeRequested?: boolean } = {}) {
  const onStatus = vi.fn()
  const insertRef: { current: Insert | null } = { current: null }
  const view = render(
    <Terminal
      labId="abc"
      session={0}
      closeRequested={props.closeRequested ?? false}
      onStatus={onStatus}
      socketFactory={FakeSocket.factory}
      insertRef={insertRef}
    />,
  )
  return { ...view, onStatus, insertRef, socket: FakeSocket.last(), terminal: lastTerminal() }
}

function insert(ref: { current: Insert | null }, text: string): InsertResult {
  if (!ref.current) throw new Error('no insert function')
  return ref.current(text)
}

const encoded = (text: string) => new TextEncoder().encode(text)

beforeEach(() => {
  FakeSocket.instances = []
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('Terminal', () => {
  it('opens the terminal and connects to the lab with its size', () => {
    const { socket, terminal, getByTestId } = renderTerminal()

    expect(terminal.element).toBe(getByTestId('terminal'))
    expect(socket.url).toBe('ws://localhost:3000/ws/labs/abc/terminal')
    socket.open()
    expect(socket.sent[0]).toBe(JSON.stringify({ type: 'init', cols: 80, rows: 24 }))
  })

  it('reports the connection status', () => {
    const { socket, onStatus } = renderTerminal()
    socket.ready()
    expect(onStatus).toHaveBeenLastCalledWith({ state: 'connected' })

    socket.serverClose(4410)
    expect(onStatus).toHaveBeenLastCalledWith({
      state: 'closed',
      reason: 'O laboratório foi encerrado.',
      code: 4410,
    })
  })

  it('sends keystrokes and writes output', () => {
    const { socket, terminal } = renderTerminal()
    socket.ready()

    terminal.dataHandler('pwd\r')
    socket.receive(new TextEncoder().encode('/home/student\r\n').buffer)

    expect(socket.sent.at(-1)).toEqual(new TextEncoder().encode('pwd\r'))
    expect(new TextDecoder().decode(terminal.written[0])).toBe('/home/student\r\n')
  })

  it('sends one resize after the size settles', () => {
    vi.useFakeTimers()
    const { socket, terminal } = renderTerminal()
    socket.ready()

    terminal.resizeHandler({ cols: 100, rows: 30 })
    terminal.resizeHandler({ cols: 120, rows: 32 })
    vi.advanceTimersByTime(150)

    const resizes = socket.sent.filter((message) => typeof message === 'string').slice(1)
    expect(resizes).toEqual([JSON.stringify({ type: 'resize', cols: 120, rows: 32 })])
  })

  it('closes the connection when asked', () => {
    const { socket, rerender, onStatus } = renderTerminal()
    socket.ready()

    rerender(
      <Terminal
        labId="abc"
        session={0}
        closeRequested
        onStatus={onStatus}
        socketFactory={FakeSocket.factory}
      />,
    )

    expect(socket.closedWith).toBe(1000)
  })

  it('closes the socket and disposes the terminal on unmount', () => {
    const { socket, terminal, unmount } = renderTerminal()
    socket.ready()

    unmount()

    expect(socket.closedWith).toBe(1000)
    expect(terminal.disposed).toBe(true)
  })

  describe('inserting a command', () => {
    it('needs an open connection', () => {
      const { socket, insertRef } = renderTerminal()

      expect(insert(insertRef, 'ls -la')).toBe('not_connected')
      socket.open()
      expect(insert(insertRef, 'ls -la')).toBe('not_connected')
      expect(socket.sent.filter((message) => typeof message !== 'string')).toEqual([])
    })

    it('pastes a single line exactly, with no Enter', () => {
      const { socket, terminal, insertRef } = renderTerminal()
      socket.ready()

      expect(insert(insertRef, 'grep -r "x y" .')).toBe('inserted')

      expect(socket.sent.at(-1)).toEqual(encoded('grep -r "x y" .'))
      expect(terminal.focused).toBeGreaterThan(0)
    })

    it('pastes several lines only inside bracketed paste markers', () => {
      const { socket, terminal, insertRef } = renderTerminal()
      socket.ready()
      const command = 'for i in 1 2\ndo echo $i\ndone'

      expect(insert(insertRef, command)).toBe('needs_bracketed_paste')
      expect(socket.sent.filter((message) => typeof message !== 'string')).toEqual([])

      terminal.modes.bracketedPasteMode = true
      expect(insert(insertRef, command)).toBe('inserted')
      expect(socket.sent.at(-1)).toEqual(
        encoded('\x1b[200~for i in 1 2\rdo echo $i\rdone\x1b[201~'),
      )
    })

    it('is gone once the terminal is unmounted', () => {
      const { socket, insertRef, unmount } = renderTerminal()
      socket.ready()

      unmount()

      expect(insertRef.current).toBeNull()
    })
  })
})
