# linux-lab-web

Web interface for Linux Lab, a platform for learning Linux by solving problems in a real terminal, inside an isolated environment created for each student.

This repository holds the frontend. Today it contains the lab terminal page; authentication, the progress dashboard and mission pages are planned. The API and the lab runtime live in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api).

## Why

Learning Linux by typing whatever command each lesson names trains syntax recall. Linux Lab presents a problem, hands over a real shell and checks the result without requiring any particular command. The interface should stay out of the way: the terminal and the problem are what matter.

## How it works

- The page `/?lab=<lab id>` opens a terminal on an existing lab.
- The terminal is xterm.js connected over WebSocket to a `bash` shell inside the lab container. Nothing is emulated in the browser.
- The page shows the connection state and lets the user close the terminal and reconnect. The lab reset button is shown disabled.

Frontend and API are served from the same origin. There is no login yet; when it exists, the session will be an `HttpOnly` cookie set by the API and the frontend will store no tokens.

Planned, not implemented yet: login, modules and missions with progress, validation of the lab state and lab reset.

The interface text is in Portuguese.

## Pages

Planned pages:

| Route | Contents |
|---|---|
| `/login`, `/signup` | Authentication. Sign-up requires an invite code during the closed beta |
| `/` | Overall progress, modules and missions with their status |
| `/missions/:slug` | Problem, objectives and hints; terminal; lab state; validation, reset, and the explanation after completion |

Today there is one page: `/?lab=<lab id>` opens the terminal of a lab created with the development command described in `linux-lab-api`.

## Terminal

The client implements the protocol described in [docs/terminal.md](https://github.com/FranciscoPedro06/linux-lab-api/blob/main/docs/terminal.md) in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api):

- binary frames for terminal bytes, JSON for control messages (`init`, `resize`);
- the terminal is sized to its container with the fit addon, and resizes are debounced;
- close codes are shown as a reason next to the connection status: shell exited, terminal opened in another tab, lab unavailable, server error, connection lost.

`src/terminal/connection.ts` holds the protocol and `src/terminal/Terminal.tsx` connects it to xterm.js. After a disconnect the page offers to reconnect; automatic reconnection with backoff is planned. Each reconnect opens a new shell in the same lab.

## Stack

| Area | Technology |
|---|---|
| Base | React, TypeScript, Vite |
| Routing | React Router |
| Data fetching | TanStack Query |
| Terminal | `@xterm/xterm`, `@xterm/addon-fit` |
| Markdown | `react-markdown`, raw HTML disabled |
| Styling | CSS Modules and CSS custom properties |
| Tests | Vitest, Playwright |

No component library. The interface is small and the terminal takes most of the screen.

## Running

The full local environment (PostgreSQL, API and this dev server) is started from [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api) with Docker Compose, with both repositories cloned side by side. See its README.

To run only the frontend, with Node.js 22 or later:

```sh
npm ci
npm run dev
```

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8000`, keeping the same-origin setup used in production. Set `API_PROXY_TARGET` to point it elsewhere, and `DEV_WATCH_POLLING=true` where file change events do not arrive (the Compose environment sets it). Open http://localhost:5173/?lab=<lab id>.

There is no Dockerfile. In production the built files are served by Caddy, configured in `linux-lab-api`.

## Tests

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs the same commands.

- **Vitest:** the terminal client (protocol, input, output, resize, close codes) against a fake WebSocket, and the terminal component and page in jsdom with xterm.js replaced by a recorder.
- **Playwright:** planned; one end-to-end flow against the real API.
- **TypeScript** in strict mode.

## Status

Increments 01 and 03 are done here: Vite, React and TypeScript setup with CI, then the terminal page with xterm.js. Development order follows [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api): the terminal lands in increment 03, authentication in 04, the catalog and mission page in 06, validation and progress in 08 and 09.

## License

[MIT](LICENSE)
