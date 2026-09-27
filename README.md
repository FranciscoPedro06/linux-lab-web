# linux-lab-web

Web interface for Linux Lab, a platform for learning Linux by solving problems in a real terminal, inside an isolated environment created for each student.

This repository holds the frontend: authentication, progress dashboard, mission page and terminal. The API, labs, validation and mission content live in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api).

## Why

Learning Linux by typing whatever command each lesson names trains syntax recall. Linux Lab presents a problem, hands over a real shell and checks the result without requiring any particular command. The interface should stay out of the way: the terminal and the problem are what matter.

## How it works

- The student logs in and sees modules and missions with their progress.
- On a mission page, they read the problem and start the lab.
- The terminal is xterm.js connected over WebSocket to a `bash` shell inside the student's container. Nothing is emulated in the browser.
- Validate asks the API to check the lab state and shows the result of each condition.
- Reset recreates the environment in the mission's initial state.

The frontend stores no tokens. The session is an `HttpOnly` cookie set by the API, and frontend and API are served from the same origin.

The interface text is in Portuguese.

## Pages

| Route | Contents |
|---|---|
| `/login`, `/signup` | Authentication. Sign-up requires an invite code during the closed beta |
| `/` | Overall progress, modules and missions with their status |
| `/missions/:slug` | Problem, objectives and hints; terminal; lab state; validation, reset, and the explanation after completion |

## Terminal

The client implements the protocol defined in [docs/api.md](https://github.com/FranciscoPedro06/linux-lab-api/blob/main/docs/api.md) in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api):

- binary frames for terminal bytes, JSON for control messages (`init`, `resize`);
- debounced resize;
- reconnect with backoff after a dropped connection;
- handling of close codes: shell exited, terminal opened in another tab, lab ended, invalid session.

Each reconnect opens a new shell in the same lab. Files and background processes are still there.

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

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8000`, keeping the same-origin setup used in production. Set `API_PROXY_TARGET` to point it elsewhere. Open http://localhost:5173.

There is no Dockerfile. In production the built files are served by Caddy, configured in `linux-lab-api`.

## Tests

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs the same commands.

- **Vitest:** isolated logic, mainly the terminal client (protocol, reconnect, close codes).
- **Playwright:** planned; one end-to-end flow against the real API: sign-up, starting a lab, running a command and validating the first mission.
- **TypeScript** in strict mode.

## Status

Increment 01 is done: Vite, React and TypeScript setup, a minimal home page that reports API health, and CI. Development order follows [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api): the terminal lands in increment 03, authentication in 04, the catalog and mission page in 06, validation and progress in 08 and 09.

## License

[MIT](LICENSE)
