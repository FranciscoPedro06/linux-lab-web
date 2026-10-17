# linux-lab-web

Web interface for Linux Lab, a platform for learning Linux by solving problems in a real terminal, inside an isolated environment created for each student.

This repository holds the frontend. Today it contains login, sign-up, the signed-in home with the user's lab and the mission catalog, a page for each mission that starts its lab, and the lab page with its terminal and the validation of the lab's state, with the user's progress on each mission in the catalog and on the mission page. The API and the lab runtime live in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api).

## Why

Learning Linux by typing whatever command each lesson names trains syntax recall. Linux Lab presents a problem, hands over a real shell and checks the result without requiring any particular command. The interface should stay out of the way: the terminal and the problem are what matter.

## How it works

- `/login` and `/signup` create a session; `/` shows the signed-in user's lab and lets them log out.
- The home page lists the published modules and missions. `/missions/:slug` shows a mission's problem, objectives and hints, and starts a lab for it. The API prepares the lab (the mission's setup) before answering, which can take up to about a minute; meanwhile the button reads "Preparando…" and accepts no second click. Then the page opens the lab.
- From `/` the user follows the active lab, opens its terminal or ends it, and sees why previous labs ended (for example, running out of memory).
- `/labs/:id` shows the lab as the API reports it, with the mission and the version it was created for, and opens the terminal only while the lab is ready. The terminal is xterm.js connected over WebSocket to a `bash` shell inside the lab container. Nothing is emulated in the browser.
- Logging out ends the user's lab on the server.

Frontend and API are served from the same origin. The session is an `HttpOnly` cookie set by the API; the frontend never sees the token and stores nothing about the session in `localStorage` or `sessionStorage`.

A user has one active lab. While it exists, the page of another mission says that switching missions is not available yet and links to the current lab; it never replaces it.

On the lab page, the student asks the API to verify the lab and sees, condition by condition, whether the lab meets the mission. The first validation that passes records the completion of the mission, which the panel announces; a later one says the mission was already completed, and a failing one that the earlier completion is kept. An operational error is shown as a failure of the check, not of the student.

The catalog and the mission page mark completed missions. A completion belongs to the mission, not to a version: one recorded on an earlier version stays a completion and names that version. The mission page compares it with the catalog's version, not with the version of the user's lab it may be showing.

After a validation, the progress in the response replaces the cached one in the catalog and the mission detail. If the request fails without an answer from the API (a dropped connection or a 5xx), the completion may have been stored anyway, so both are read again from the API; the validation itself is never retried.

Planned, not implemented yet: lab reset, switching a lab to another mission, and the explanation and solutions after completion (a candidate for increment 14).

The interface text is in Portuguese.

## Pages

| Route | Contents | Status |
|---|---|---|
| `/login` | Email and password | Implemented |
| `/signup` | Name, email, password and invite code (required during the closed beta) | Implemented |
| `/` | Signed out: links to login and sign-up. Signed in: the current lab and its mission (preparing, ready with a link to its terminal and an end button, ending), the published modules and their missions, previous labs with their mission and end reason, and logout. Completed missions are marked | Implemented |
| `/labs/:id` | The lab's state from the API and its mission and version: preparing, ready with the terminal and the validation panel, or ended with the reason and a button to start a new lab for the same mission. Requires a session; a lab of another user or an unknown id shows "not found" | Implemented |
| `/missions/:slug` | Module, title, summary, difficulty, estimated time and tags; the problem (Markdown), objectives and hints; the user's lab for it: a button to start one, a link to the one already open for this mission, or, when the active lab is for another mission, a notice and a link to it; whether the user completed the mission, and on which version if not the current one. Requires a session; an unknown or unpublished mission shows "not found" | Implemented |
| `/missions/:slug` with a lab | Reset (increment 10), and the explanation and solutions after completion (candidate for increment 14); the terminal and validation stay on `/labs/:id` | Planned |

Unknown paths redirect to `/`. A signed-in user who opens `/login` or `/signup` is sent to `/`; a signed-out visitor who opens `/labs/:id` or `/missions/:slug` is sent to `/login`. The old development entry `/?lab=<id>` no longer opens anything.

## Authentication

`src/auth/api.ts` calls the endpoints described in [docs/api.md](https://github.com/FranciscoPedro06/linux-lab-api/blob/main/docs/api.md) in `linux-lab-api` with `fetch` and `credentials: 'same-origin'`. Every non-GET request is sent as JSON, which the API requires together with an allowed `Origin`. Errors arrive as `{ "error": { "code", "message" } }`; the message, already in Portuguese, is shown as it is.

`src/auth/session.ts` keeps the current user in a TanStack Query query on `/api/auth/me`, with four states: loading, signed in, signed out (the API answered `401`) and error. Login, sign-up and logout update that query instead of storing anything themselves.

The session cookie is `Secure`. During development, browsers that treat `http://localhost` as a secure context, such as Chrome, Edge and Firefox, accept it; a browser that does not will not keep the session.

## Labs

`src/lab/api.ts` calls the lab endpoints; `src/lab/queries.ts` keeps them in TanStack Query. The API owns the lifecycle: the client never decides a lab's state, it shows what `GET /api/labs/current` and `GET /api/labs/{id}` report. It polls every second while a lab is `provisioning` or `terminating`, and every 15 seconds while it is `ready`, since the server can end it (timeouts, OOM) at any time. Logout removes every cached lab.

A lab is created with `POST /api/labs` and `{ "mission_slug": ... }`, from the mission's page or, for the same mission, from an ended lab's page. The client sends nothing else; the API picks the mission version, parameters, setup and limits. The request is synchronous and returns once the lab is ready or has failed. The API's error messages (`active_lab_for_different_mission`, `lab_start_failed`, `mission_not_found` and others) are shown as they are, and a refused start refreshes the current lab so the page shows what blocks it.

## Validation

The validation panel sits on `/labs/:id`, below the terminal, so the student checks the lab without leaving it. `validateLab` in `src/lab/api.ts` calls `POST /api/labs/{id}/validate`; `useValidateLab` in `src/lab/queries.ts` runs it as a TanStack Query mutation with no automatic retry. Nothing is validated automatically: the request is sent only when the student presses "Verificar", the button is disabled while it runs, and a failed request is repeated only from an explicit "Tentar novamente".

The body is `{}`, or `{ "answer": ... }` when the mission expects an answer and the field is not empty (an empty field is sent as no answer, which the API reports as such): the panel reads `requires_answer` from `GET /api/missions/{slug}`, which the API answers at the lab's version, and shows the answer field only then. Answers longer than the API's limit (1024 bytes in UTF-8) are refused before sending. The client sends nothing else; the mission version, conditions and limits come from the server.

The response is shown as the API sent it: concluded (`passed`), not yet concluded (`failed`) with the status and message of each condition, or an operational error (`error`), which does not count as an attempt and offers a new try. Messages are plain strings rendered as text. A `409 lab_not_ready` or `404` refreshes the lab, so the page shows that it ended; `409 validation_in_progress` and `429 rate_limited` show the API's message.

## Catalog

`src/catalog/api.ts` calls `GET /api/modules` and `GET /api/missions/{slug}`; `src/catalog/queries.ts` keeps them in TanStack Query. The API returns only published content and only presentation fields, in catalog order: modules by slug, missions in the order of their module. An empty catalog is shown as such, not as an error. A `401` makes the page check the session again; a `404` is not retried.

Briefings are Markdown, rendered with `react-markdown` with raw HTML dropped (`skipHtml`) and its default URL filter, which removes `javascript:` links. Objectives and hints keep only inline code and emphasis. No plugin that renders HTML is installed.

## Terminal

The client implements the protocol described in [docs/terminal.md](https://github.com/FranciscoPedro06/linux-lab-api/blob/main/docs/terminal.md) in [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api):

- the session cookie goes with the WebSocket handshake; the page never sees it;
- binary frames for terminal bytes, JSON for control messages (`init`, `resize`);
- the terminal is sized to its container with the fit addon, and resizes are debounced;
- close codes reach the page with a reason shown next to the connection status.

`src/terminal/connection.ts` holds the protocol, `src/terminal/Terminal.tsx` connects it to xterm.js, and `src/terminal/reconnect.ts` decides about reconnecting:

| Close code | What the page does |
|---|---|
| 4401 | Checks the session again; a signed-out user is sent to login |
| 4404, 4410 | Reads the lab from the API and shows its state and end reason |
| 4409, 4000, 1000, 1008, 1009 | Shows the reason and a Reconnect button; no automatic reconnection |
| 1001, 1006, 1011, 1012, 1013, 1014 | Reconnects automatically after 1, 2, 4, 8 and 16 seconds, at most 5 times, each time only if the API still reports the lab `ready`; then stops and offers Reconnect |

Each reconnect opens a new shell in the same lab.

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

The Vite dev server proxies `/api` and `/ws` to `http://localhost:8000`, keeping the same-origin setup used in production. Set `API_PROXY_TARGET` to point it elsewhere, and `DEV_WATCH_POLLING=true` where file change events do not arrive (the Compose environment sets it). Open http://localhost:5173, sign up and start a lab.

There is no Dockerfile. In production the built files are served by Caddy, configured in `linux-lab-api`.

## Tests

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

CI runs the same commands.

- **Vitest:** the terminal client (protocol, input, output, resize, close codes) against a fake WebSocket; the reconnection policy; the terminal component in jsdom with xterm.js replaced by a recorder; the authentication client; the login, sign-up, home, lab and mission pages against a fake `fetch`, including lab states, OOM, 4401, 4410, automatic reconnection with fake timers, the catalog's empty, error and not found states, Markdown with raw HTML, the validation panel (loading, first completion, a mission completed before, a failure after a completion, operational error, refusals, the answer field and the absence of automatic retries), and progress (completed and not completed missions, a completion on an earlier version, the cache updated from the response, and progress read again after a network or server failure).
- **Browser:** each increment is checked by hand in Chromium (Playwright) against the Compose environment, with real cookies, WebSocket and Docker; an automated end-to-end suite is planned.
- **TypeScript** in strict mode.

## Status

Increments 01 and 03 to 09 are done here: Vite, React and TypeScript setup with CI, the terminal page with xterm.js, login and sign-up, labs tied to the account with their lifecycle and terminal reconnection, the mission catalog and mission page, then labs started from a mission, the validation panel on the lab page, and the user's progress in the catalog, the mission page and the panel. Development order follows [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api): the terminal lands in increment 03, authentication in 04, the catalog and mission page in 06, labs started for a mission in 07, validation and progress in 08 and 09, reset and mission switching in 10.

## License

[MIT](LICENSE)
