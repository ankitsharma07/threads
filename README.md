# Threads

Fast, readable conversations directly in Thunderbird's message pane.

Select an email or a thread and Threads shows the whole conversation in place: every message as a card, the latest one open, older ones a click away. There is no extra tab, window or sidebar, and nothing leaves your computer.

**Requires Thunderbird 147 or newer.**

## Install

1. Download the latest `threads-x.y.z.xpi` from [Releases](https://github.com/ankitsharma07/threads/releases/latest).
2. In Thunderbird, open **Add-ons and Themes**, click the gear menu, and choose **Install Add-on From File…**.
3. Select the downloaded file and accept the permissions.

Threads updates itself when a new release is published. Thunderbird checks for add-on updates about once a day; to check now, use the gear menu → **Check for Updates** in Add-ons and Themes.

Thunderbird shows a privileged-access notice during installation. Threads replaces the message pane's display using an Experiment API, which add-ons need for that kind of integration. See [What Threads can access](#what-threads-can-access).

> Disable **Thunderbird Conversations** while using Threads. Both replace the message pane and will conflict.

## Using Threads

- **Read a conversation.** Select any message in a thread. Cards are ordered oldest first by default; long conversations (more than 10 messages) fold the middle messages behind a count you can click to expand.
- **Expand and collapse.** Click a card's header. While you read a long message, its header stays pinned at the top.
- **Quoted text and signatures** are tucked away: click **···** to show quoted history, with one bar per reply level. Click the signature line to read the full signature.
- **Recipients.** Each open card shows a one-line "to … · cc …" summary. **Details** shows every address. Hover or click an address to filter the folder, create a filter, add a contact, or write to them.
- **Attachments** appear under the message. Click a name to open it, or use the download button. **Save all** saves every file to your download folder. Image attachments preview inline.
- **More actions.** The **⋯** button on each card offers reply, reply all, forward, forward as attachment, mark read/unread, star, open in a new tab or window, show the original message, copy text or Message-ID, save as `.eml`, archive and move to Trash.
- **Original message** in the toolbar switches back to Thunderbird's normal message view. The **Threads** toolbar button switches back.

### Settings

Use the sliders button in the reader, or **Add-ons and Themes → Threads → Options**. Changes apply immediately and are saved in your Thunderbird profile.

- **Theme.** System, Light, Dark, What Grey, Pitch black, Sepia, Midnight blue, Forest, Plum. With **System**, a dark desktop uses What Grey.
- **Reading.** Font (System, Sans serif, Serif, Humanist, Rounded, High legibility, Monospace), text size and line spacing. Only fonts installed on your computer are used.
- **Order.** Oldest first or newest first.
- **Allow remote content.** Remote images are blocked unless you turn this on.
- **Fold long threads** and **Show image attachments inline**.
- **Index controls.** Pause or resume the background mailbox index, or rescan after importing old mail.

### How it finds conversations

Threads builds a local index of message headers so a conversation can include your replies from Sent and messages in other folders. Indexing starts with the last 30 days, then six months, then older mail. You can read while it runs. Messages are joined only through their `References` and `In-Reply-To` headers; matching subjects alone never merge conversations.

## What Threads can access

Everything Threads stores stays in your Thunderbird profile. It sends no data anywhere and contains no analytics. Read the full [privacy policy](PRIVACY.md).

| Permission | Why |
| --- | --- |
| Read your email messages, accounts | Show conversations and build the local thread index |
| Experiment API (full access) | Display conversations inside Thunderbird's existing message pane |
| Compose | Reply, reply all and forward in Thunderbird's compose window |
| Update, move and delete messages | Mark read/unread, star, archive and move to Trash from the ⋯ menu |
| Downloads | Save attachments and `.eml` files |
| Address books, mail tabs | Add contacts, filter the current folder by an address |
| Clipboard (write) | Copy addresses, message text and Message-IDs |
| Storage | Remember your settings |

## Limits

- Message text is rebuilt from the original as clean, safe text. Paragraphs, lists, bold, italic, links, code and quotes are kept; HTML layout, colours and custom fonts are not. Use **Original message** for the sender's exact layout.
- Quote detection follows common mail-client conventions and is not language-aware. Unusual or interleaved replies may land inside the quoted section.
- RSS, news, drafts and templates use Thunderbird's normal view.
- This is an early release. Please [report problems](https://github.com/ankitsharma07/threads/issues) with your Thunderbird version and, if possible, the message source (View → Message Source) with personal details removed.

## Development

No build step or runtime dependencies: the add-on is plain ES modules. Packaging needs Python 3; tests need Node.js.

```sh
npm ci                 # test-only dependency (fake-indexeddb)
npm test
npm run benchmark
python3 build.py       # writes dist/threads-<version>.xpi
```

Preview the reader in a browser against a mocked Thunderbird API:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# open http://127.0.0.1:8765/tests/preview.html   (?n=40 for a long thread, &slow for slow loads)
```

How it works internally (indexing, the virtual list, the parser and caches) is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Releasing

1. Set the new version in `manifest.json` and `package.json`, and add a `## <version>` section to [CHANGELOG.md](CHANGELOG.md). Threads uses an Experiment API, so `strict_max_version` must name the newest Thunderbird it has been tested with; raise it (for example to `159.*`) after checking each new Thunderbird release.
2. Run `python3 release.py`. It builds the XPI, adds it with its SHA-256 hash to `updates.json`, writes release notes to `dist/`, and prints the remaining commands.
3. Push the tag, create the GitHub release with the built XPI attached, then push `main`. Installed copies update once `updates.json` on `main` lists the new version.
4. For addons.thunderbird.net, upload `dist/threads-<version>-atn.xpi`. It is identical except that it leaves out the GitHub `update_url`, because ATN delivers updates to its own installs.

## License

[MIT](LICENSE)
