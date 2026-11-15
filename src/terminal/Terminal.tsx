import { FitAddon } from '@xterm/addon-fit'
import { type ITheme, Terminal as XTerm } from '@xterm/xterm'
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

const FONT_FAMILY = "'Ubuntu Sans Mono', ui-monospace, 'DejaVu Sans Mono', monospace"

// The terminal takes its colors from the page's tokens (src/index.css), so bash and the
// interface are one screen and change theme together. The fallbacks are the tty theme.
function terminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement)
  const token = (name: string, fallback: string) =>
    style.getPropertyValue(`--${name}`).trim() || fallback
  const bg = token('bg', '#000000')
  const fg = token('fg', '#bcbcbc')
  return {
    background: bg,
    foreground: fg,
    cursor: fg,
    cursorAccent: bg,
    selectionBackground: fg,
    selectionForeground: bg,
    black: token('bg-alt', '#1c1c1c'),
    red: token('red', '#ff5f5f'),
    green: token('green', '#00af00'),
    yellow: token('yellow', '#ffd700'),
    blue: token('blue', '#5f87ff'),
    magenta: token('magenta', '#d75fd7'),
    cyan: token('cyan', '#00d7d7'),
    white: fg,
    brightBlack: token('dim', '#8a8a8a'),
    brightRed: token('red', '#ff5f5f'),
    brightGreen: token('green', '#00af00'),
    brightYellow: token('yellow', '#ffd700'),
    brightBlue: token('blue', '#5f87ff'),
    brightMagenta: token('magenta', '#d75fd7'),
    brightCyan: token('cyan', '#00d7d7'),
    brightWhite: token('bright', '#ffffff'),
  }
}

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
      cursorStyle: 'block',
      fontFamily: FONT_FAMILY,
      fontSize: 14,
      theme: terminalTheme(),
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(element)
    fit.fit()

    let disposed = false
    // xterm.js measures the font when it opens. If Ubuntu Sans Mono arrives later, set the
    // family again so it measures the real cells, then fit.
    void document.fonts
      ?.load(`14px ${FONT_FAMILY}`)
      .then(() => {
        if (disposed) return
        terminal.options.fontFamily = FONT_FAMILY
        fit.fit()
      })
      .catch(() => {
        // The fallback face is already in use; nothing to measure again.
      })
    const scheme =
      typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: light)') : null
    const retheme = () => {
      terminal.options.theme = terminalTheme()
    }
    scheme?.addEventListener('change', retheme)

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
      disposed = true
      scheme?.removeEventListener('change', retheme)
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
