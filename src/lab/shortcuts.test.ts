// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { AREA_SHORTCUTS, shortcutFor } from './shortcuts.ts'

type Init = KeyboardEventInit & { keyCode?: number }

// A keydown on `target` (the terminal's input unless said otherwise).
function press(init: Init, target: Element = terminalInput()): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  if (init.keyCode !== undefined) Object.defineProperty(event, 'keyCode', { value: init.keyCode })
  Object.defineProperty(event, 'target', { value: target })
  return event
}

function terminalInput(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea')
  textarea.className = 'xterm-helper-textarea'
  document.body.append(textarea)
  return textarea
}

const ctrlShift = { ctrlKey: true, shiftKey: true }

afterEach(() => {
  document.body.innerHTML = ''
})

describe('shortcutFor', () => {
  it.each([
    ['Digit1', 'terminal'],
    ['Digit2', 'criteria'],
    ['Digit3', 'history'],
  ])('maps Ctrl+Shift+%s to %s, from the terminal', (code, area) => {
    expect(shortcutFor(press({ ...ctrlShift, code, key: '!' }))).toEqual({ area, act: true })
  })

  it('reads the key position, whatever Shift prints on the layout', () => {
    for (const key of ['!', '@', '"', '#', '¹']) {
      expect(shortcutFor(press({ ...ctrlShift, code: 'Digit2', key }))?.area).toBe('criteria')
    }
  })

  it.each([
    ['Ctrl+1', { ctrlKey: true, code: 'Digit1' }],
    ['Shift+1', { shiftKey: true, code: 'Digit1' }],
    ['Alt+1', { altKey: true, code: 'Digit1' }],
    ['Ctrl+Alt+Shift+1 (AltGr)', { ...ctrlShift, altKey: true, code: 'Digit1' }],
    ['Cmd+Ctrl+Shift+1', { ...ctrlShift, metaKey: true, code: 'Digit1' }],
    ['Ctrl+Shift+4', { ...ctrlShift, code: 'Digit4' }],
    ['Ctrl+Shift+numpad 1', { ...ctrlShift, code: 'Numpad1' }],
    ['Ctrl+C', { ctrlKey: true, code: 'KeyC' }],
    ['Ctrl+V', { ctrlKey: true, code: 'KeyV' }],
    ['Ctrl+Shift+C (copy in terminals)', { ...ctrlShift, code: 'KeyC' }],
    ['Ctrl+Shift+V (paste in terminals)', { ...ctrlShift, code: 'KeyV' }],
    ['Ctrl+A', { ctrlKey: true, code: 'KeyA' }],
    ['Ctrl+Z', { ctrlKey: true, code: 'KeyZ' }],
    ['Ctrl+R', { ctrlKey: true, code: 'KeyR' }],
    ['F5', { code: 'F5' }],
    ['a', { code: 'KeyA', key: 'a' }],
    ['1', { code: 'Digit1', key: '1' }],
  ])('leaves %s alone', (_name, init) => {
    expect(shortcutFor(press(init))).toBeNull()
  })

  it('leaves the keys alone while text is being composed', () => {
    expect(shortcutFor(press({ ...ctrlShift, code: 'Digit1', isComposing: true }))).toBeNull()
    expect(shortcutFor(press({ ...ctrlShift, code: 'Digit1', keyCode: 229 }))).toBeNull()
  })

  it('does not act on a key held down', () => {
    expect(shortcutFor(press({ ...ctrlShift, code: 'Digit3', repeat: true }))).toEqual({
      area: 'history',
      act: false,
    })
  })

  it('does not act in a text field other than the terminal', () => {
    const fields = [
      document.createElement('input'),
      document.createElement('textarea'),
      document.createElement('select'),
    ]
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    for (const field of [...fields, editable]) {
      document.body.append(field)
      expect(shortcutFor(press({ ...ctrlShift, code: 'Digit1' }, field))?.act).toBe(false)
    }
  })

  it('does not act inside a dialog', () => {
    for (const role of ['dialog', 'alertdialog']) {
      const dialog = document.createElement('section')
      dialog.setAttribute('role', role)
      const button = document.createElement('button')
      dialog.append(button)
      document.body.append(dialog)
      expect(shortcutFor(press({ ...ctrlShift, code: 'Digit2' }, button))?.act).toBe(false)
    }
  })

  it('labels each shortcut as it is read', () => {
    expect(AREA_SHORTCUTS).toEqual({
      terminal: { code: 'Digit1', label: 'Ctrl+Shift+1', aria: 'Control+Shift+1' },
      criteria: { code: 'Digit2', label: 'Ctrl+Shift+2', aria: 'Control+Shift+2' },
      history: { code: 'Digit3', label: 'Ctrl+Shift+3', aria: 'Control+Shift+3' },
    })
  })
})
