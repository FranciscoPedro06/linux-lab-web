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

A user has one active lab. While it exists, the page of another mission links to it and offers to switch to this mission; the lab page offers to reset the lab. Both replace the lab with a new one only after the user confirms that its files, processes and temporary state will be discarded, and both keep the user's progress.

On the lab page, the student asks the API to verify the lab and sees, condition by condition, whether the lab meets the mission. The first validation that passes records the completion of the mission, which the panel announces; a later one says the mission was already completed, and a failing one that the earlier completion is kept. An operational error is shown as a failure of the check, not of the student.

Next to the terminal, the lab page shows the lab's command history: the lines the lab's bash accepted, as the API recorded them. A notice above the terminal says, before it is used, that commands sent to bash may be saved, sensitive text and heredoc bodies included, that the history stays readable by its owner after the lab ends, that starting a line with a space tries to keep it out, that this is no guarantee, and that nothing removes passwords, tokens or other secrets automatically. Each command can be copied or inserted into the terminal without being run. An ended lab shows its history when asked.

The catalog and the mission page mark completed missions. A completion belongs to the mission, not to a version: one recorded on an earlier version stays a completion and names that version. The mission page compares it with the catalog's version, not with the version of the user's lab it may be showing.

After a validation, the progress in the response replaces the cached one in the catalog and the mission detail. If the request fails without an answer from the API (a dropped connection or a 5xx), the completion may have been stored anyway, so both are read again from the API; the validation itself is never retried.

Cached labs and catalog belong to the user named by the last session check: when a check names someone else, or nobody, they are dropped before anything renders. Signing in, signing up or logging out also drops them. A lab or validation request records who started it; if its answer arrives after another user signed in, it is not written to the cache. A session check still in flight when someone signs in is cancelled, so it cannot sign them out again.

The session cookie is shared by every tab, so tabs are coordinated with the Web Locks API and a `BroadcastChannel` (`src/auth/tabs.tsx`):

- A tab shows a signed-in user's pages only while it holds the `linux-lab-session` lock in shared mode, and only after asking the API who is signed in since it took the lock. Pages are hidden, not unmounted, so an open terminal keeps its connection; they are mounted again when the user changes.
- Login, sign-up and logout run under the same lock in exclusive mode, which the browser grants only when no tab holds it shared. The tab first posts `session-changing` (no data in any message); the others hide their pages and release the lock, and hidden tabs have released it already. The request is sent only once the lock is granted, so while the cookie changes no tab shows private pages. Then `session-changed` or `session-unchanged` is posted, the lock is released, and every tab asks the API again before showing anything.
- If a visible tab does not release the lock within 5 seconds, the change is refused before anything is sent: "Outra aba do Linux Lab não liberou a sessão." A tab told that a change started but never how it ended checks the session on its own after 60 seconds, still behind the lock.
- A tab that becomes hidden hides its pages and releases the lock; when it is shown again it takes the lock and asks the API first.
- Supported browsers are those with Web Locks and `BroadcastChannel` (Chrome 69+, Edge 79+, Firefox 96+, Safari 15.4+). Elsewhere signing in and signing up are refused, so no other user can be signed in there; logging out still works.

Planned, not implemented yet: the explanation and solutions after completion (a candidate for increment 14).

The interface text is in Portuguese.

## Pages

| Route | Contents | Status |
|---|---|---|
| `/login` | Email and password | Implemented |
| `/signup` | Name, email, password and invite code (required during the closed beta) | Implemented |
| `/` | Signed out: links to login and sign-up. Signed in: the current lab and its mission (preparing, ready with a link to its terminal and an end button, ending), the published modules and their missions, previous labs with their mission and end reason, and logout. Completed missions are marked | Implemented |
| `/labs/:id` | The lab's state from the API and its mission and version: preparing, ready with the terminal, the history notice and panel, the validation panel and a reset, or ended with the reason, its command history on request and a button to start a new lab for the same mission. A lab that was reset or switched points to the user's current lab instead. Requires a session; a lab of another user or an unknown id shows "not found" | Implemented |
| `/missions/:slug` | Module, title, summary, difficulty, estimated time and tags; the problem (Markdown), objectives and hints; the user's lab for it: a button to start one, a link to the one already open for this mission, or, when the active lab is for another mission, a link to it and a switch to this mission; whether the user completed the mission, and on which version if not the current one. Requires a session; an unknown or unpublished mission shows "not found" | Implemented |
| `/missions/:slug` with a lab | The explanation and solutions after completion (candidate for increment 14); the terminal and validation stay on `/labs/:id` | Planned |

Unknown paths redirect to `/`. A signed-in user who opens `/login` or `/signup` is sent to `/`; a signed-out visitor who opens `/labs/:id` or `/missions/:slug` is sent to `/login`. The old development entry `/?lab=<id>` no longer opens anything.

## Authentication

`src/auth/api.ts` calls the endpoints described in [docs/api.md](https://github.com/FranciscoPedro06/linux-lab-api/blob/main/docs/api.md) in `linux-lab-api` with `fetch` and `credentials: 'same-origin'`. Every non-GET request is sent as JSON, which the API requires together with an allowed `Origin`. Errors arrive as `{ "error": { "code", "message" } }`; the message, already in Portuguese, is shown as it is.

`src/auth/session.ts` keeps the current user in a TanStack Query query on `/api/auth/me`, with four states: loading, signed in, signed out (the API answered `401`) and error. Login, sign-up and logout update that query instead of storing anything themselves.

The session cookie is `Secure`. During development, browsers that treat `http://localhost` as a secure context, such as Chrome, Edge and Firefox, accept it; a browser that does not will not keep the session.

## Labs

`src/lab/api.ts` calls the lab endpoints; `src/lab/queries.ts` keeps them in TanStack Query. The API owns the lifecycle: the client never decides a lab's state, it shows what `GET /api/labs/current` and `GET /api/labs/{id}` report. It polls every second while a lab is `provisioning` or `terminating`, and every 15 seconds while it is `ready`, since the server can end it (timeouts, OOM) at any time. Logout removes every cached lab.

A lab is created with `POST /api/labs` and `{ "mission_slug": ... }`, from the mission's page or, for the same mission, from an ended lab's page. The client sends nothing else; the API picks the mission version, parameters, setup and limits. The request is synchronous and returns once the lab is ready or has failed. The API's error messages (`active_lab_for_different_mission`, `lab_start_failed`, `mission_not_found` and others) are shown as they are, and a refused start refreshes the current lab so the page shows what blocks it.

### Reset and mission switch

Both call `POST /api/labs/{id}/replace` with `{ "mission_slug": ... }`: the lab's own mission for a reset (lab page, "Reiniciar laboratório"), another mission for a switch (that mission's page, "Trocar para esta missão", offered only while the current lab is ready). The API ends the lab, removes its container and creates a new lab, with a new id, container and parameters; the request returns once the new lab is ready or has failed, which can take up to about two minutes.

- Nothing is sent before the user confirms, in a dialog that says the lab's files, processes and temporary state are discarded and that progress is kept: a reset neither completes nor undoes a mission. The safe choice, "Cancelar", has the focus.
- While the request runs, the page shows "Reiniciando o laboratório…" or "Trocando de missão…" and no button that could send it again. The old lab's terminal is closed as soon as the reset starts; on the lab page the request is held above the lab's state, so the old lab ending meanwhile does not replace that screen.
- On success the page opens the new lab (`/labs/:id`, one page mount per lab, so its terminal connects to the new lab only). The old lab, the current lab, the list and the details of both missions are read again; progress is not changed by the client.
- The client never retries a replacement by itself. After any failure it reads the old lab and the current lab again, and offers what the API state allows:
  - the old lab still ready (the request was refused before it ended: `mission_not_found`, `rate_limited`, `lab_capacity_reached`): the API's message, and the lab as it was;
  - another lab active (the replacement happened elsewhere, or the answer was lost): a link to it;
  - the old lab still being removed (`previous_lab_not_removed`): "A remoção deste laboratório ainda não terminou." and "Tentar novamente", which asks for the same replacement and resumes it;
  - no active lab (`lab_start_failed`, or a replacement interrupted after the old lab ended): "Iniciar novo laboratório", which is `POST /api/labs`. Asking for the same replacement again would never create a second new lab, only be refused.
- A lost answer (`network_error`) or a `500` is reported as "Não foi possível confirmar o resultado", and the state read again decides what is offered; nothing destructive is sent before it.
- An ended lab with `end_reason` `reset` or `mission_switch` explains it and points to the current lab, if any.

## Command history

`fetchHistory` in `src/lab/api.ts` calls `GET /api/labs/{id}/history?after=<seq>&limit=500` until `more` is false; `useLabHistory` in `src/lab/queries.ts` keeps the entries under `['labs', 'history', id]`. Each read asks only for entries after the last one held and keeps only greater `seq` values, so polling and overlapping pages never show an entry twice, and a failed read is made up by the next one. While the lab is `ready` the history is read every 5 seconds, only while the tab is visible; for an ended lab it is read once, when the student asks, and never polled. The client never writes to the history: entries are recorded by the API from the terminal only.

`src/lab/HistoryPanel.tsx` shows the entries in `seq` order as plain text (`<pre><code>`), the newest 200 first with a button for earlier ones, and scrolls to new entries when the list is already at its end. It has loading, empty and error states with a retry, keeps the entries it has when a refresh fails, and says when the lab reached the API's limit of 2000 entries. Switching to another lab mounts a new page, so nothing of the previous lab's history is shown, and the key's `['labs']` prefix is dropped with the other labs when the session changes. Requests also use the query's abort signal, so an answer meant for a previous user is discarded.

- **Copy** writes the command to the clipboard with `navigator.clipboard.writeText`, or says to copy it by hand when the browser refuses.
- **Insert** hands the command to the open terminal (`insertRef` of `src/terminal/Terminal.tsx`), which pastes it with xterm.js's `paste`: no Enter is added, and the student runs it with Enter after reviewing it. bash turns on bracketed paste at its prompt, so xterm.js wraps the text in paste markers and line breaks stay part of the command line instead of running it. A command with a line break is inserted only while the terminal reports bracketed paste on; otherwise the panel asks to copy it instead. Insertion needs a connected terminal and is not offered for ended labs.

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

Each reconnect opens a new shell in the same lab. The lab's command history continues across reconnects.

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

- **Vitest:** the terminal client (protocol, input, output, resize, close codes) against a fake WebSocket; the reconnection policy; the terminal component in jsdom with xterm.js replaced by a recorder; the authentication client; the login, sign-up, home, lab and mission pages against a fake `fetch`, including lab states, OOM, 4401, 4410, automatic reconnection with fake timers, the catalog's empty, error and not found states, Markdown with raw HTML, the validation panel (loading, first completion, a mission completed before, a failure after a completion, operational error, refusals, the answer field and the absence of automatic retries), and progress (completed and not completed missions, a completion on an earlier version, the cache updated from the response, and progress read again after a network or server failure), and the command history (empty and filled, pages, polling without duplicates, failed refreshes, the limit, ended labs read on request, copy, insertion without Enter and bracketed paste for several lines, the notice, a lab switch, and an answer for a previous user never stored).
- **Browser:** each increment is checked by hand in Chromium (Playwright) against the Compose environment, with real cookies, WebSocket and Docker; an automated end-to-end suite is planned.
- **TypeScript** in strict mode.

## Status

Increments 01, 03 to 10 and 12 are done here: Vite, React and TypeScript setup with CI, the terminal page with xterm.js, login and sign-up, labs tied to the account with their lifecycle and terminal reconnection, the mission catalog and mission page, then labs started from a mission, the validation panel on the lab page, the user's progress in the catalog, the mission page and the panel, and lab reset and mission switching, and the command history next to the terminal. Development order follows [linux-lab-api](https://github.com/FranciscoPedro06/linux-lab-api): the terminal lands in increment 03, authentication in 04, the catalog and mission page in 06, labs started for a mission in 07, validation and progress in 08 and 09, reset and mission switching in 10, the command history in 12.

## License

[MIT](LICENSE)
