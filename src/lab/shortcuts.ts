// Keyboard shortcuts of the lab page: one per area, and nothing else. They only move
// between Terminal, Critérios and Histórico; none runs a command or touches the lab.
//
// Ctrl+Shift+1, 2 and 3, read from the key's position (`event.code`), so they are the
// same keys on every layout and whatever Shift prints there. On every system:
// - Alt+digit switches tabs in Chrome and Firefox on Linux, and is readline's numeric
//   argument in bash;
// - Ctrl+Alt is AltGr on many layouts (ABNT2 types ¹ ² ³ with it);
// - Cmd+Shift+3 is a screenshot on macOS;
// - Ctrl+digit switches tabs or desktops.
// Ctrl+Shift+digit has no default in Chrome, Firefox, Windows, GNOME or macOS. In the
// terminal, Ctrl+Shift+2 can no longer send NUL (Ctrl+@); Ctrl+Space still does.

export type Area = 'terminal' | 'criteria' | 'history'

export const AREA_SHORTCUTS: Record<Area, { code: string; label: string; aria: string }> = {
  terminal: { code: 'Digit1', label: 'Ctrl+Shift+1', aria: 'Control+Shift+1' },
  criteria: { code: 'Digit2', label: 'Ctrl+Shift+2', aria: 'Control+Shift+2' },
  history: { code: 'Digit3', label: 'Ctrl+Shift+3', aria: 'Control+Shift+3' },
}

// The terminal's own input: xterm.js reads keys from this textarea, and the shortcuts
// must work while the student types there.
const TERMINAL_INPUT = '.xterm-helper-textarea'

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target.matches(TERMINAL_INPUT)) return false
  if (target.closest('input, textarea, select')) return true
  return target instanceof HTMLElement && target.isContentEditable
}

function inDialog(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[role="dialog"], [role="alertdialog"], dialog') !== null
  )
}

// What to do with a key press:
// - null: not a shortcut (any other key or modifier, or text being composed with an
//   IME), left to the page and the terminal untouched;
// - `act: true`: switch to `area`, and keep the key from the terminal and the browser;
// - `act: false`: the shortcut, but held down (auto-repeat), typed in a text field other
//   than the terminal, or inside a dialog. Nothing switches; a repeat is still kept from
//   the terminal, so holding the keys sends nothing to the shell.
export function shortcutFor(event: KeyboardEvent): { area: Area; act: boolean } | null {
  if (event.isComposing || event.keyCode === 229) return null
  if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey) return null
  const area = (Object.keys(AREA_SHORTCUTS) as Area[]).find(
    (name) => AREA_SHORTCUTS[name].code === event.code,
  )
  if (!area) return null
  const act = !event.repeat && !inTextField(event.target) && !inDialog(event.target)
  return { area, act }
}
