import { FitAddon } from '@xterm/addon-fit'
import { Terminal as XTerm } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { type RefObject, useEffect, useRef } from 'react'
import styles from './Terminal.module.css'
import {
  type ConnectionStatus,
  type SocketFactory,
  TerminalConnection,
  terminalUrl,
} from './connection.ts'

const RESIZE_DEBOUNCE_MS = 100

// Puts text on the shell's command line without running it.
// - inserted: pasted; the student reviews it and presses Enter.
// - not_connected: there is no open connection to paste into.
// - needs_bracketed_paste: the text has a line break and the program in the terminal
//   has not turned on bracketed paste, so the break would act as Enter and run it.
export type InsertResult = 'inserted' | 'not_connected' | 'needs_bracketed_paste'
export type Insert = (text: string) => InsertResult

type TerminalProps = {
  labId: string
  onStatus: (status: ConnectionStatus) => void
  // Changing this value opens a new connection.
  session: number
  // Set to close the current connection, e.g. from a Close button.
  closeRequested: boolean
  socketFactory?: SocketFactory
  // Set to a function that inserts text while this terminal is mounted.
  insertRef?: RefObject<Insert | null>
}

export function Terminal({
  labId,
  onStatus,
  session,
  closeRequested,
  socketFactory,
  insertRef,
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
    // xterm.js wraps pasted text in bracketed paste markers when the program asked for
    // them (bash does at its prompt), so line breaks are inserted rather than run. It
    // adds no Enter. Without the markers only single-line text is safe to paste.
    const insert: Insert = (text) => {
      if (!current.connected) return 'not_connected'
      if (/[\r\n]/.test(text) && !terminal.modes.bracketedPasteMode) {
        return 'needs_bracketed_paste'
      }
      terminal.paste(text)
      terminal.focus()
      return 'inserted'
    }
    if (insertRef) insertRef.current = insert
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
      if (insertRef?.current === insert) insertRef.current = null
    }
  }, [labId, session, socketFactory, insertRef])

  useEffect(() => {
    if (closeRequested) connection.current?.close()
  }, [closeRequested])

  return <div className={styles.terminal} ref={container} data-testid="terminal" />
}
