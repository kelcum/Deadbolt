/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import type { Channel, Guild, Message, RenderModalProps, User } from "@vencord/discord-types";
import { ChannelStore, GuildStore, Menu, Modal, openModal, showToast, UserStore, useState, useStateFromStores } from "@webpack/common";

import { activeRules, Rule, Scope, shouldSilence, validId } from "./rules";

const settings = definePluginSettings({
    rules: { type: OptionType.CUSTOM, description: "Local notification rules", default: [] as Rule[], hidden: true }
});
const durations = [[15, "15 minutes"], [60, "1 hour"], [480, "8 hours"], [1440, "24 hours"], [0, "Until removed"]] as const;
const all = () => activeRules(settings.store.rules ?? [], Date.now());

function add(owner: string, scope: Scope, id: string, minutes: number) {
    if (UserStore.getCurrentUser()?.id !== owner || !validId(id)) return;
    const old = all().filter(r => !(r.owner === owner && r.scope === scope && r.id === id));
    if (old.length >= 200) return showToast({ text: "Notification rule limit reached.", variant: "critical" });
    settings.store.rules = [...old, { scope, id, owner, expires: minutes ? Date.now() + minutes * 60_000 : 0 }];
    showToast({ text: "Local notification rule saved." });
}
function remove(owner: string, scope: Scope, id: string) {
    if (UserStore.getCurrentUser()?.id !== owner) return;
    settings.store.rules = all().filter(r => !(r.owner === owner && r.scope === scope && r.id === id));
}
function item(scope: Scope, id: string, owner: string) {
    if (!validId(id) || !validId(owner)) return null;
    const exists = all().some(r => r.owner === owner && r.scope === scope && r.id === id);
    return <Menu.MenuItem id={`db-notify-${scope}`} label="Local notification control">
        {durations.map(([minutes, title]) => <Menu.MenuItem key={minutes} id={`db-notify-${scope}-${minutes}`} label={minutes ? `Silence for ${title}` : "Silence until removed"} action={() => add(owner, scope, id, minutes)} />)}
        {exists && <Menu.MenuItem id={`db-notify-remove-${scope}`} label="Remove silence rule" action={() => remove(owner, scope, id)} />}
    </Menu.MenuItem>;
}
const userMenu: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => { const owner = UserStore.getCurrentUser()?.id; if (owner && user && owner !== user.id) children.push(item("user", user.id, owner)); };
const channelMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: Channel; }) => { const owner = UserStore.getCurrentUser()?.id; if (owner && channel) children.push(item("channel", channel.id, owner)); };
const guildMenu: NavContextMenuPatchCallback = (children, { guild }: { guild?: Guild; }) => { const owner = UserStore.getCurrentUser()?.id; if (owner && guild) children.push(item("server", guild.id, owner)); };

const Panel = ErrorBoundary.wrap(({ userId, modalProps }: { userId: string; modalProps: RenderModalProps; }) => {
    const account = useStateFromStores([UserStore], () => UserStore.getCurrentUser()?.id);
    const [revision, setRevision] = useState(0);
    const rules = all().filter(r => r.owner === userId);
    function label(rule: Rule) {
        if (rule.scope === "user") return UserStore.getUser(rule.id)?.username ?? rule.id;
        if (rule.scope === "server") return GuildStore.getGuild(rule.id)?.name ?? rule.id;
        return ChannelStore.getChannel(rule.id)?.name || rule.id;
    }
    return <Modal {...modalProps} size="md" title="Notification control" subtitle="Local silence rules. Messages and unread badges are left untouched." actions={[{ text: "Refresh", variant: "secondary", onClick: () => setRevision(n => n + 1) }, { text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        {account !== userId ? <Text size="sm">Account changed.</Text> : <div key={revision} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {!rules.length && <Text size="sm">No active rules. Right-click a user, server or channel to add one.</Text>}
            {rules.map(r => <div key={`${r.scope}-${r.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}><div><Text size="sm" weight="semibold">{label(r)}</Text><Text size="xs" color="text-muted">{r.scope} · {r.expires ? new Date(r.expires).toLocaleString() : "Until removed"}</Text></div><Button size="small" variant="secondary" onClick={() => { remove(userId, r.scope, r.id); setRevision(n => n + 1); }}>Unsilence</Button></div>)}
        </div>}
    </Modal>;
});
function open() { const userId = UserStore.getCurrentUser()?.id; if (userId) openModal(props => <Panel userId={userId} modalProps={props} />); }
export default definePlugin({
    name: "NotificationControl", description: "Silence local message notifications from selected people, channels and servers for a chosen duration without altering messages or unread counts.", authors: [Devs.Zot], tags: ["Notifications", "Utility"], settings,
    contextMenus: { "user-context": userMenu, "channel-context": channelMenu, "thread-context": channelMenu, "gdm-context": channelMenu, "guild-context": guildMenu }, toolboxActions: { "Notification rules": open }, settingsAboutComponent: () => <Button size="small" onClick={open}>Open notification rules</Button>,
    patches: [{ find: '"NotificationStore"', replacement: { match: /(?<=MESSAGE_CREATE:function\(\i\)\{)/, replace: "if($self.shouldSilence(arguments[0]))return!1;" } }],
    shouldSilence(event: { message?: Message; channelId?: string; guildId?: string; }) {
        const owner = UserStore.getCurrentUser()?.id;
        const message = event?.message;
        if (!owner || !message) return false;
        const channel = message.channel_id || event.channelId;
        const server = event.guildId || (channel ? ChannelStore.getChannel(channel)?.guild_id : undefined);
        return shouldSilence(settings.store.rules ?? [], owner, { user: message.author?.id, channel, server }, Date.now());
    }
});
