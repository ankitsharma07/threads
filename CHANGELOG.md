# Changelog

## 0.6.2

- **Paragraphs.** Paragraphs in HTML mail keep the blank line between them instead of running together. Outlook mail stays single-spaced, as Outlook shows it.
- **Full width.** Message text fills the reading pane instead of wrapping at a fixed width.
- **Faster loading on IMAP.** Opening a message that isn't indexed yet reads it from the server once instead of twice, and background indexing pauses while messages are loading. Messages still waiting in line keep loading instead of showing **Retry**.

## 0.6.1

- **Read state.** Opening a conversation in Threads marks its unread messages as read, following Thunderbird's "Automatically mark messages as read" setting and its optional delay.
- **Smoother motion.** Cards glide when you expand or collapse a message, bodies fade in instead of popping in, unfolded messages cascade in, and menus, popovers and the loading pill animate in and out. All of it is turned off when your system asks for reduced motion.

## 0.6.0

First public release.

- **Self-updating.** Installs from GitHub Releases and updates itself from there. The add-on ID is now permanent (`threads@nezubn.com`). If you used a development build, remove it before installing this version.
- **Reading settings.** Choose the message font (System, Sans serif, Serif, Humanist, Rounded, High legibility, Monospace), text size and line spacing, with a live preview on the settings page.
- **Quoted text.** Quoted history sits behind a compact **···** toggle that shows its "On … wrote:" line. Each reply level gets its own bar, and Outlook-style From/Sent/To/Subject blocks show as a compact table.
- **Signatures** collapse to a one-line preview.
- **Recipients** collapse to one "to … · cc …" line, with the full address list under **Details**.
- **Dates.** Open messages show the time ("Today, 10:42").
- **Privacy policy** added.

## 0.5.6

- The toolbar button is labelled **Threads**.
- With the **System** theme, a dark desktop uses the What Grey palette.

## 0.5.5

- **Attachments** are listed under each message, with open, save and **Save all**. Image attachments, including inline images, preview inline (toggle: **Show image attachments inline**).
- **⋯ menu on every card:** reply, reply all, forward, forward as attachment, mark read/unread, star, open in a new tab or window, show the original message, copy text or Message-ID, save as `.eml`, save attachments, archive, move to Trash.
- **Line breaks** in HTML mail now match how a browser lays out blocks, so lines no longer run together.
- New permissions: update, move and delete messages; downloads.

## 0.5.4

- **Formatting** from HTML mail is kept: nested bulleted and numbered lists, bold, italic, underline, inline code and headings. Plain-text mail gets indented lists and `*emphasis*`.
- **Smoother scrolling.** The loading indicator no longer pushes the conversation down while messages load, and scrolling no longer rewrites the page on every frame.

## 0.5.2

- Settings page in the Add-ons Manager, kept in sync with the reader.
- Named links keep their labels and open in your default browser; plain URLs are clickable.

## 0.5.0

- Conversations open in Thunderbird's existing message pane; **Original message** switches back.
- Reply, Reply all and Forward on each message; address menus to filter, create filters, add contacts and write emails.
- Themes: System, Light, Dark, What Grey, Pitch black, Sepia, Midnight blue, Forest, Plum. Oldest-first or newest-first order.
- Long conversations fold their middle messages. Remote images are blocked unless allowed.
- Code blocks keep their exact formatting. A progress indicator shows loading stages.
- Your sent replies in other folders join the conversation through their reply headers, never by subject alone.
