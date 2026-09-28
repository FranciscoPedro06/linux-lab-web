import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { useEffect, useRef } from 'react'
import styles from './Terminal.module.css'
import {
  type ConnectionStatus,
  type SocketFactory,
  TerminalConnection,
  terminalUrl,
} from './connection.ts'

const RESIZE_DEBOUNCE_MS = 100

type TerminalProps = {
  labId: string
  onStatus: (status: ConnectionStatus) => void
  // Changing this value opens a new connection.
  session: number
  // Set to close the current connection, e.g. from a Close button.
  closeRequested: boolean
  socketFactory?: SocketFactory
}

export function Terminal({
  labId,
  onStatus,
  session,
  closeRequested,
  socketFactory,
}: TerminalProps) {
  const container = useRef<HTMLDivElement>(null)
  const connection = useRef<TerminalConnection | null>(null)
  const statusHandler = useRef(onStatus)

  useEffect(() => {
    statusHandler.current = onStatus
  }, [onStatus])

  useEffect(() => {
    const element = container.current
    if (!element) return

    const terminal = new XTerm({
      cursorBlink: true,
      fontFamily: "ui-monospace, 'Cascadia Mono', 'DejaVu Sans Mono', monospace",
      fontSize: 14,
      theme: { background: '#16181a', foreground: '#e3e3e3' },
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    fit.fit()

    const current = new TerminalConnection(
      terminalUrl(labId),
      { cols: terminal.cols, rows: terminal.rows },
      {
        onOutput: (data) => terminal.write(data),
        onStatus: (status) => {
          if (status.state === 'connected') terminal.focus()
          statusHandler.current(status)
        },
      },
      socketFactory,
    )
    connection.current = current

    const input = terminal.onData((data) => current.send(data))
    let pending: ReturnType<typeof setTimeout> | undefined
    const resize = terminal.onResize((size) => {
      clearTimeout(pending)
      pending = setTimeout(() => current.resize(size), RESIZE_DEBOUNCE_MS)
    })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit.fit())
    observer?.observe(element)

    return () => {
      clearTimeout(pending)
      observer?.disconnect()
      input.dispose()
      resize.dispose()
      current.close()
      terminal.dispose()
      connection.current = null
    }
  }, [labId, session, socketFactory])

  useEffect(() => {
    if (closeRequested) connection.current?.close()
  }, [closeRequested])

  return <div className={styles.terminal} ref={container} data-testid="terminal" />
}
