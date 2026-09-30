# linux-lab-web

Web interface for Linux Lab, a platform for learning Linux by solving problems in a real terminal, inside an isolated environment created for each student.

This repository holds the frontend. Today it contains login, sign-up and the lab terminal page; the progress dashboard and mission pages are planned. The API and the lab runtime live in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api).

## Why

Learning Linux by typing whatever command each lesson names trains syntax recall. Linux Lab presents a problem, hands over a real shell and checks the result without requiring any particular command. The interface should stay out of the way: the terminal and the problem are what matter.

## How it works

- `/login` and `/signup` create a session; `/` shows whether the user is signed in and lets them log out.
- The page `/?lab=<lab id>` opens a terminal on an existing lab.
- The terminal is xterm.js connected over WebSocket to a `bash` shell inside the lab container. Nothing is emulated in the browser.
- The page shows the connection state and lets the user close the terminal and reconnect. The lab reset button is shown disabled.

Frontend and API are served from the same origin. The session is an `HttpOnly` cookie set by the API; the frontend never sees the token and stores nothing about the session in `localStorage` or `sessionStorage`.

Planned, not implemented yet: modules and missions with progress, labs tied to the account, validation of the lab state and lab reset.

The interface text is in Portuguese.

## Pages

| Route | Contents | Status |
|---|---|---|
| `/login` | Email and password | Implemented |
| `/signup` | Name, email, password and invite code (required during the closed beta) | Implemented |
| `/` | Entry page: loading, signed out (links to login and sign-up), signed in (name and logout), or an error with retry | Implemented; replaced by the dashboard with modules and progress later |
| `/?lab=<lab id>` | Terminal of a lab created with the development command described in `linux-lab-api`. Needs no account, since labs are not tied to users yet | Development only |
| `/missions/:slug` | Problem, objectives and hints; terminal; lab state; validation, reset, and the explanation after completion | Planned |

Unknown paths redirect to `/`. A signed-in user who opens `/login` or `/signup` is sent to `/`.

## Authentication

`src/auth/api.ts` calls the endpoints described in [docs/api.md](https://github.com/FranciscoPedro06/linux-lab-api/blob/main/docs/api.md) in `linux-lab-api` with `fetch` and `credentials: 'same-origin'`. Every non-GET request is sent as JSON, which the API requires together with an allowed `Origin`. Errors arrive as `{ "error": { "code", "message" } }`; the message, already in Portuguese, is shown as it is.

`src/auth/session.ts` keeps the current user in a TanStack Query query on `/api/auth/me`, with four states: loading, signed in, signed out (the API answered `401`) and error. Login, sign-up and logout update that query instead of storing anything themselves.

The session cookie is `Secure`. During development, browsers that treat `http://localhost` as a secure context, such as Chrome, Edge and Firefox, accept it; a browser that does not will not keep the session.

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

- **Vitest:** the terminal client (protocol, input, output, resize, close codes) against a fake WebSocket; the terminal component and page in jsdom with xterm.js replaced by a recorder; the authentication client, and the login, sign-up and entry pages against a fake `fetch`.
- **Playwright:** planned; one end-to-end flow against the real API.
- **TypeScript** in strict mode.

## Status

Increments 01, 03 and 04 are done here: Vite, React and TypeScript setup with CI, the terminal page with xterm.js, then login and sign-up. Development order follows [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api): the terminal lands in increment 03, authentication in 04, the catalog and mission page in 06, validation and progress in 08 and 09.

## License

[MIT](LICENSE)
