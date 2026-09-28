// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App.tsx'

// The page is tested with a stand-in terminal; the real one is covered by Terminal.test.tsx.
vi.mock('./terminal/Terminal.tsx', () => ({
  Terminal: ({ closeRequested }: { closeRequested: boolean }) => (
    <div data-testid="terminal">{closeRequested ? 'close requested' : 'open'}</div>
  ),
}))

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

describe('App', () => {
  it('explains how to pick a lab when none is given', () => {
    render(<App />)

    expect(screen.getByText(/Nenhum laboratório selecionado/)).toBeTruthy()
    expect(screen.queryByTestId('terminal')).toBeNull()
  })

  it('shows the terminal, its status and the lab actions', () => {
    window.history.replaceState(null, '', '/?lab=abc')
    render(<App />)

    expect(screen.getByTestId('terminal').textContent).toBe('open')
    expect(screen.getByRole('status').textContent).toContain('Conectando')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Reiniciar/ }).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }))
    expect(screen.getByTestId('terminal').textContent).toBe('close requested')
  })
})
