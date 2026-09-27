import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { App } from './App.tsx'

describe('App', () => {
  it('renders the title and a pending API status', () => {
    const html = renderToString(<App />)

    expect(html).toContain('Linux Lab')
    expect(html).toContain('verificando')
  })
})
