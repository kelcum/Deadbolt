/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { HeaderBarButton } from "@api/HeaderBar";
import { definePluginSettings } from "@api/Settings";
import { Paragraph } from "@components/Paragraph";
import { Devs } from "@utils/constants";
import { getGuildAcronym } from "@utils/discord";
import { classNameFactory } from "@utils/css";
import definePlugin, { OptionType } from "@utils/types";
import { GuildScheduledEvent, RenderModalProps } from "@vencord/discord-types";
import { ChannelStore, Clickable, GuildScheduledEventStore, GuildStore, IconUtils, lodash, Modal, moment, NavigationRouter, openModal, useStateFromStores } from "@webpack/common";

const cl = classNameFactory("vc-events-calendar-");
const SCHEDULED = 1;
const ACTIVE = 2;

const SETTING_KEYS: ("daysAhead" | "interestedOnly")[] = ["daysAhead", "interestedOnly"];

const settings = definePluginSettings({
    daysAhead: {
        type: OptionType.SLIDER,
        description: "How many days ahead the calendar shows.",
        markers: [7, 14, 30, 60, 90],
        default: 30
    },
    interestedOnly: {
        type: OptionType.BOOLEAN,
        description: "Only show events you marked yourself interested in.",
        default: false
    }
});

const REPEATS = ["Repeats yearly", "Repeats monthly", "Repeats weekly", "Repeats daily"];

function interested(event: GuildScheduledEvent) {
    return GuildScheduledEventStore.isInterestedInEventRecurrence(event.id, null);
}

function collect(daysAhead: number, interestedOnly: boolean) {
    const until = moment().add(daysAhead, "days").endOf("day").valueOf();
    return GuildStore.getGuildIds()
        .flatMap(id => GuildScheduledEventStore.getGuildScheduledEventsForGuild(id))
        .filter(e => (e.status === ACTIVE || (e.status === SCHEDULED && Date.parse(e.scheduled_start_time) <= until)) && (!interestedOnly || interested(e)))
        .sort((a, b) => Date.parse(a.scheduled_start_time) - Date.parse(b.scheduled_start_time));
}

function useEvents() {
    const { daysAhead, interestedOnly } = settings.use(SETTING_KEYS);
    return useStateFromStores([GuildScheduledEventStore, GuildStore], () => collect(daysAhead, interestedOnly), [daysAhead, interestedOnly], lodash.isEqual);
}

function dayLabel(day: moment.Moment) {
    const diff = day.diff(moment().startOf("day"), "days");
    if (diff <= 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return day.format(diff < 7 ? "dddd" : "dddd, MMMM D");
}

function group(events: GuildScheduledEvent[]) {
    const groups: { label: string; events: GuildScheduledEvent[]; }[] = [];
    for (const event of events) {
        const label = event.status === ACTIVE ? "Happening now" : dayLabel(moment(event.scheduled_start_time).startOf("day"));
        const last = groups[groups.length - 1];
        if (last?.label === label) last.events.push(event);
        else groups.push({ label, events: [event] });
    }
    return groups;
}

function place(event: GuildScheduledEvent) {
    if (event.entity_metadata?.location) return event.entity_metadata.location;
    const channel = event.channel_id ? ChannelStore.getChannel(event.channel_id) : null;
    return channel ? channel.name : null;
}

function time(event: GuildScheduledEvent) {
    const start = moment(event.scheduled_start_time);
    const end = event.scheduled_end_time ? moment(event.scheduled_end_time) : null;
    if (event.status === ACTIVE) return end ? `Until ${end.format("LT")}` : `Started ${start.fromNow()}`;
    return end ? `${start.format("LT")} to ${end.format(end.isSame(start, "day") ? "LT" : "MMM D, LT")}` : start.format("LT");
}

function open(event: GuildScheduledEvent) {
    NavigationRouter.transitionTo(`/events/${event.guild_id}/${event.id}`);
}

function Row({ event, onOpen }: { event: GuildScheduledEvent; onOpen(): void; }) {
    const guild = GuildStore.getGuild(event.guild_id);
    const icon = guild?.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }) : null;
    const where = place(event);
    const repeats = event.recurrence_rule ? REPEATS[event.recurrence_rule.frequency] : null;
    const details = [guild?.name, where, repeats].filter(Boolean).join(" · ");

    return (
        <Clickable className={cl("row")} onClick={onOpen}>
            {icon
                ? <img className={cl("icon")} src={icon} alt="" />
                : <div className={cl("icon", "acronym")}>{guild ? getGuildAcronym(guild) : null}</div>}
            <div className={cl("body")}>
                <div className={cl("meta")}>
                    <span className={cl("time", { live: event.status === ACTIVE })}>{time(event)}</span>
                    {interested(event) && <span className={cl("interested")}>Interested</span>}
                </div>
                <div className={cl("name")}>{event.name}</div>
                {details && <div className={cl("details")}>{details}</div>}
            </div>
        </Clickable>
    );
}

function CalendarModal({ modalProps }: { modalProps: RenderModalProps; }) {
    const events = useEvents();
    const { interestedOnly, daysAhead } = settings.store;

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Events"
            subtitle={`Scheduled events in all your servers for the next ${daysAhead} days. Click one to see its details.`}
            actions={[
                { text: interestedOnly ? "Show all events" : "Only interested", variant: "secondary", onClick: () => settings.store.interestedOnly = !interestedOnly },
                { text: "Close", variant: "primary", onClick: modalProps.onClose }
            ]}
        >
            {events.length
                ? <div className={cl("list")}>{group(events).map(({ label, events }) => (
                    <div key={label}>
                        <div className={cl("day")}>{label}</div>
                        {events.map(event => <Row key={event.id} event={event} onOpen={() => { modalProps.onClose(); open(event); }} />)}
                    </div>
                ))}</div>
                : <Paragraph className={cl("empty")}>{interestedOnly ? "No upcoming events you're interested in." : "None of your servers have events coming up."}</Paragraph>}
        </Modal>
    );
}

function CalendarIcon({ width, height }: { width?: number; height?: number; }) {
    const live = useEvents().some(e => e.status === ACTIVE);

    return (
        <svg width={width} height={height} viewBox="0 0 24 24" fill="currentColor">
            <path d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1V3a1 1 0 0 1 1-1ZM4 10v9a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-9H4Zm3 2h3v3H7v-3Z" />
            {live && <circle className={cl("dot")} cx="20" cy="4" r="4" />}
        </svg>
    );
}

function CalendarButton() {
    const events = useEvents();
    const live = events.filter(e => e.status === ACTIVE).length;
    const tooltip = live ? `Events (${live} happening now)` : events.length ? `Events (${events.length} coming up)` : "Events";
    return <HeaderBarButton icon={CalendarIcon} tooltip={tooltip} onClick={() => openModal(props => <CalendarModal modalProps={props} />)} />;
}

export default definePlugin({
    name: "EventsCalendar",
    description: "Lists the scheduled events from all your servers by date in one place, behind a button in the top bar.",
    tags: ["Servers", "Utility"],
    authors: [Devs.K3],
    settings,

    headerBarButton: {
        icon: CalendarIcon,
        render: CalendarButton
    }
});
