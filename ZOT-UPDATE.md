# Zot expansion (development only)

Author: **Zot**, Discord ID `1531412914005606513`. All 26 new plugins are original implementations, opt-in, and GPL-3.0-or-later. Existing plugin authors and copyright notices are retained.

## New plugins

Enable individually in Deadbolt plugin settings.

| Plugin | Usage |
| --- | --- |
| AttachmentOrganizer | Right-click a message containing attachments; /dbattachments lists bookmarks. |
| BetterFormatting | /dbformat copies formatted Markdown. |
| BetterFriendList | /dbfriendsearch filters cached friends. |
| BetterNSFWTag | Adds an age-restricted channel indicator in the toolbar. |
| ChannelHistory | /dbhistory lists recent channels for this session. |
| FocusTimer | /dbfocus starts or stops a local timer. |
| LinkInspector | /dblinkinspect inspects a link without opening it. |
| LocalAliases | /dbalias saves and searches local names without renaming Discord's interface. |
| MessageReminders | /dbreminder adds and manages reminders while the client runs. |
| MessageTemplates | /dbtemplate saves and copies reusable text. |
| OnlineFriendCount | /dbfriends counts friends by visible presence. |
| PersonalChecklist | /dbchecklist manages local tasks. |
| PersonalPins | Right-click a message or use /dbpins to manage bookmarks. |
| PluginCompatibility | /dbplugincheck checks declared dependencies and restart requirements; not a live patch compatibility test. |
| PluginInventory | /dbpluginlist filters and copies installed plugin names and states. |
| QuickNotes | /dbnote manages local notes. |
| RoleExplorer | /dbroles searches roles and cached role members. |
| ServerCounter | /dbservers counts joined servers. |
| ServerDetails | /dbserverdetails shows a compact cached server summary. |
| SessionRestore | /dbsession explicitly saves and reopens a channel link. |
| TextRedactor | /dbredact copies text with common sensitive patterns masked. |
| WorkspaceProfiles | /dbworkspace manages named channel links. |

Local data is not encrypted and can be included in backups or sync. Never store credentials in these plugins. Local command responses use Deadbolt's existing local message helper and can be visible to other enabled plugins.

## Visual expansion

| Feature | Usage |
| --- | --- |
| Workspace | Header bar workspace with notes, task checkboxes, saved template copying, bookmarks, workspaces and reminder overview. |
| TemplatePicker | Chat bar template search, copy and draft insertion; never automatically sends. |
| UnreadInbox | Header bar panel to filter cached unread channels and mentions; opens only channels the local permission store allows. |
| ConnectionMonitor | Header bar panel for the last 20 observed connection events and the browser network indicator. |

Workspace was renamed from ZotWorkspace using the existing settings migration helper. The workspace shares the original plugins' account-specific DataStore keys. The new panels do not enable other plugins automatically. The reminder panel displays stored reminders; MessageReminders must be enabled to receive alerts.

## Existing fixes

- ChatExport: restrict exported HTML links to HTTP(S), escape labels.
- Offline backups: reject malformed formats and invalid field types before import, avoid logging raw backup data, allow empty QuickCSS.
- QuickFind: bound the number of cached channels.
- TokenGuard and WrongChannelGuard: expire confirmations, bound pending confirmation state and clear timers on stop.
- DoubleSendGuard: use non-optimistic own-message creation events rather than attempts; bound history and clear on account changes.
- DraftHistory: persist expired draft cleanup when loading history and ignore stale initialization after stopping or editing.

## Validation

The original nineteen new plugins passed 20 mocked smoke-test groups and a strict TypeScript check against API stubs. The 22-plugin build at commit 924aa30 passed TypeScript, desktop and web builds on Apple Silicon macOS, with successful core-module injection and partial manual runtime testing reported by the tester. Three lint findings were corrected in commit 308248c. The four visual expansion plugins still require full build and runtime validation. No production releases or main-branch changes are part of this batch.

Run pnpm testTsc, pnpm lint, pnpm buildStandalone, pnpm buildWebStandalone and pnpm test on a clean checkout. Review changes made by the existing lint-fix step. Test desktop Windows, macOS, Linux, browser, and supported wrappers. Test each plugin disabled, enabled, stopped, and with other commonly enabled plugins. Validate backup restoration on disposable settings, not a real user profile. Do not publish or merge until these checks pass.

Deferred: updater/release signing and transaction recovery, installer, safe-mode architecture, global message hooks, plugin uploader concurrency, plugin marketplace and sandboxing, advanced audio and performance monitoring, theme/layout engines and remaining high-risk feature proposals. These are deliberately separated from this opt-in update.
