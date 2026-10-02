# Privacy policy

_Last updated: 2 October 2026_

Threads is a Thunderbird add-on that shows email conversations in Thunderbird's message pane. It is designed to keep your mail on your computer.

## Summary

- Threads does **not** send your email, contacts, settings or usage data to the developer or to anyone else.
- Threads contains **no analytics, telemetry, advertising or tracking**.
- Everything Threads stores is kept in your local Thunderbird profile and is removed when you remove the add-on.

## What Threads reads

To show a conversation, Threads reads messages through Thunderbird's add-on interface:

- **Message headers**: sender, recipients, subject, date, size and threading headers (`Message-ID`, `References`, `In-Reply-To`). These are used to build the conversation index.
- **Message bodies and attachment lists** of the messages you open. Bodies are read only for messages shown on screen.
- **Attachment files**, only when you open, save or preview them.
- **Your address books**, only when you choose to add a contact. Threads then lists the address books you can write to.

## What Threads stores, and where

All data stays in the add-on's private storage inside your Thunderbird profile:

| Data | Purpose | Retention |
| --- | --- | --- |
| Message metadata (headers listed above) and the links between messages | Find every message in a conversation quickly | Until the message is deleted from Thunderbird, or the add-on is removed |
| Formatted copies of message bodies you have opened, and their attachment lists | Reopen conversations instantly | Pruned automatically to about 100 MB; older entries are removed first |
| Your settings (theme, reading font, order, toggles) and indexing progress | Remember your choices | Until changed or the add-on is removed |

Image previews of attachments are held in memory only while the conversation is open.

## Network access

Threads itself makes **no network requests**. Its pages run under a content security policy that blocks network connections (`connect-src 'none'`), and it loads no remote scripts or fonts.

The following can involve the network, and each happens only because of Thunderbird's normal behaviour or your own action:

- **Retrieving mail.** When Threads asks Thunderbird for a message that is not stored locally (for example on an IMAP server), Thunderbird downloads it from your mail server, just as it would to display it.
- **Remote images** in messages are blocked by default. If you turn on **Allow remote content**, images load from the sender's servers without a referrer. As with any email client, this can tell the sender that you opened the message.
- **Links** you click open in your default web browser.
- **Update checks.** Thunderbird periodically checks `https://raw.githubusercontent.com/ankitsharma07/threads/main/updates.json` for new versions and downloads updates from GitHub. Like any web request, this shares your IP address and the add-on version with GitHub ([GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)). Turn off automatic updates for Threads in Add-ons and Themes to stop these checks.

## Actions that change your data

Threads changes your mail, contacts or files only when you choose an action:

- **Reply, Reply all, Forward** open Thunderbird's compose window. Nothing is sent until you send it.
- **Mark as read/unread, Star, Archive, Move to Trash** change the message in Thunderbird. Move to Trash does not permanently delete anything.
- **Add contact** creates a contact in the address book you pick.
- **Save** writes attachments or `.eml` files to the location you choose, or to your download folder for **Save all**.
- **Copy** places an address, message text or Message-ID on your clipboard.
- **Create message filter** opens Thunderbird's filter editor for you to review.

## Permissions

Thunderbird asks you to approve these permissions when you install Threads. The README explains [what each one is for](README.md#what-threads-can-access). Threads also uses an **Experiment API**, which gives it the same access as Thunderbird itself. It uses that access only to display conversations inside the existing message pane and to open the filter editor.

## Removing your data

Remove Threads in **Add-ons and Themes**, and Thunderbird deletes its stored index, cached bodies and settings. To rebuild the index without removing the add-on, use **Index controls → Rescan mailbox**.

## Changes and contact

Changes to this policy are published in this file, and its history is public in the [repository](https://github.com/ankitsharma07/threads). For questions, [open an issue](https://github.com/ankitsharma07/threads/issues).
