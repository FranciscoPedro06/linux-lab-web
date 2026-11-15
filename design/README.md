# Linux Lab design system

The interface is a terminal. It does not show a terminal inside a web page: it is the terminal's screen, and the lab's bash is one more panel of it. One face, one size, one surface, the character grid, and the colors a terminal already has.

The tokens are in `tokens.json` here and, as CSS variables, in `src/index.css`. Change both together.

## Rules

1. **One face, one size.** Everything is Ubuntu Sans Mono, 14px on a 20px line. Hierarchy comes from bold (in `--bright`), CAPITALS, `--dim` and inverse video, never from a bigger size. The one exception is the `figlet` banner (`src/Banner.tsx`).
2. **The grid rules.** Widths in columns (`ch`), heights in 20px lines. Indents of 2, 4 and 7 columns. Reading text in 80 columns.
3. **One surface.** Page, panels and xterm.js share `--bg`. No card with its own background, no shadow, no gradient. A panel is a 1px `--rule` line with its title cutting the top border.
4. **Square corners.** No border radius anywhere.
5. **No brand color.** A terminal has none. Black, grey and white make the screen; highlight is inverse video (`--fg` background, `--bg` text), like a TUI's selected item.
6. **Color only for a state**, with the meaning it already has in a terminal: `--green` passed, `--red` failed, `--yellow` in progress, `--blue` a directory or path. `--cyan` and `--magenta` only inside bash.
7. **Every color comes with a word.** `[Atendida]`, `[Não atendida]`, `[x]`, `erro:`. Nobody depends on telling green from red.
8. **Danger only when confirming.** Ending or resetting a lab is a plain button; red appears in the confirmation box (`src/lab/ConfirmReplace.module.css`).
9. **The API is the truth.** States and messages appear as the API sent them.

## Color

Every value is an entry of the xterm 256-color palette; each token's note gives the index.

- **tty** (dark, the default): pure black, text `#bcbcbc`, bold in `#ffffff`, like the Linux console.
- **xterm** (light, with `prefers-color-scheme: light`): pure white, black text, like xterm unconfigured. The ANSI colors are darker so they pass 4.5:1 on white.
- `--bg-alt` only for the top bar and text fields. `--sel` only for the row under the pointer or with focus; never `--dim` text on it.
- `--rule` draws inactive panels; the active panel (bash) has an `--fg` border.
- Focus: inverse video on buttons, links and hints; a 1px `--fg` outline on fields and on the primary button.
- xterm.js reads its theme from these variables (`terminalTheme` in `src/terminal/Terminal.tsx`) and again when the color scheme changes.

Every text pair named in the token notes is at least 4.5:1 in both themes.

## Voice

Brazilian Portuguese, direct, addressing the student as **você**, the way a Unix system writes: short, lowercase where it is machine output, normal sentences where it is conversation.

- **Buttons:** an infinitive verb in brackets, `[ Verificar ]`, `[ Tentar novamente ]`. The brackets are CSS (`button::before`/`::after` in `src/index.css`), not text.
- **In progress:** gerund with a single-character ellipsis: `Verificando…`.
- **Comments:** notices as shell comments in `--dim`: `# Os comandos enviados ao Bash podem ser salvos…`.
- **Errors:** `erro: ` in `--red` (CSS) and the API's message.
- **Results:** neutral. "Missão ainda não concluída. Veja os critérios abaixo." The color stays on the condition marks.
- **The briefing is a problem, not a recipe.** No emoji, no decorative dashes, no exclamation marks, no marketing.

## Type

Ubuntu Sans Mono 400 and 700 from `@fontsource/ubuntu-sans-mono`, bundled with the app: the Content-Security-Policy allows fonts from `'self'` only, so no font comes from a third party. It is the family of the Ubuntu 24.04 that runs in every lab. Ligatures are off: `--` is `--`.

## Terminal patterns, and where they live

| pattern | screen | code |
|---|---|---|
| `figlet -k Linux Lab` | login, sign-up, signed-out home | `src/Banner.tsx` |
| TUI panel, title on the border | home, lab | `.panel` in `src/lab/LabPanel.module.css`, `HistoryPanel.module.css`, `ValidationPanel.module.css` |
| `bash` as the active panel | lab | `.terminal` in `src/lab/LabPage.module.css` |
| one-line top bar on `--bg-alt` | lab | `.header` in `src/lab/LabPage.module.css` |
| `[x]` / `[ ]` listing | catalog | `src/catalog/Catalog.module.css` (`data-progress`) |
| manual page (NAME-style sections, 7-column bodies) | mission | `src/catalog/MissionPage.module.css` |
| `history` output (number right-aligned) | command history | `src/lab/HistoryPanel.module.css` (`data-seq`) |
| status in brackets, like a boot log | validation | `src/lab/ValidationPanel.module.css` |
| double-line box | confirmation | `src/lab/ConfirmReplace.module.css` |
| `# comment` | notices, field hints | `.notice`, `.hint` |
| `[+]` / `[-]` | hints | `summary` in `src/index.css` |
| `label: value` login prompt | login, sign-up | `.field` in `src/auth/Auth.module.css` |

Not built yet, on purpose: a key bar of shortcuts. It belongs on a screen only once the screen handles those keys, and never single letters (they fire while typing and fight screen readers); `Tab`, `Enter` and `Esc` first.

## Small screens

The lab wants 80 columns. Below 64rem the side column moves under bash, and bash keeps a fixed height. On a phone the terminal needs a bigger screen and a keyboard; say so rather than squeeze bash.

## Motion

Only what a terminal does. The cursor blinks in xterm.js; nothing else moves.
