/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 Zot
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { HeaderBarButton } from "@api/HeaderBar";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import { Text } from "@components/Text";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, useEffect, useState } from "@webpack/common";

interface TimerControls {
    remaining(): number;
    start(minutes: number): void;
    cancel(): void;
}

const TimerPanel = ErrorBoundary.wrap(({ modalProps, controls }: { modalProps: RenderModalProps; controls: TimerControls; }) => {
    const [remaining, setRemaining] = useState(controls.remaining);
    const [minutes, setMinutes] = useState("25");
    useEffect(() => {
        const interval = setInterval(() => setRemaining(controls.remaining()), 1000);
        return () => clearInterval(interval);
    }, [controls]);
    const seconds = Math.ceil(remaining / 1000);
    const display = Math.floor(seconds / 60).toString().padStart(2, "0") + ":" + (seconds % 60).toString().padStart(2, "0");
    const value = Number(minutes);
    const valid = Number.isInteger(value) && value >= 1 && value <= 240;
    function start(duration: number) {
        controls.start(duration);
        setRemaining(controls.remaining());
    }
    return <Modal {...modalProps} size="sm" title="Focus timer" actions={[{ text: "Close", variant: "primary", onClick: modalProps.onClose }]}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ textAlign: "center", padding: "16px 0" }}>
                <Text size="xxl" weight="semibold" tabularNumbers>{display}</Text>
                <Text size="sm" color="text-muted">{remaining ? "Timer running" : "Ready to start"}</Text>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
                <Button size="small" variant="secondary" onClick={() => start(5)}>5 min</Button>
                <Button size="small" variant="secondary" onClick={() => start(25)}>25 min</Button>
                <Button size="small" variant="secondary" onClick={() => start(60)}>60 min</Button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" min={1} max={240} aria-label="Minutes" value={minutes} onChange={e => setMinutes(e.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: 8, borderRadius: 6, color: "var(--text-default)", background: "var(--input-background, var(--background-base-lower))" }} />
                <Button size="small" disabled={!valid} onClick={() => start(value)}>Start</Button>
                <Button size="small" variant="secondary" disabled={!remaining} onClick={() => { controls.cancel(); setRemaining(0); }}>Stop</Button>
            </div>
        </div>
    </Modal>;
});

export function openFocusTimer(remaining: TimerControls["remaining"], start: TimerControls["start"], cancel: TimerControls["cancel"]) {
    const controls = { remaining, start, cancel };
    openModal(props => <TimerPanel modalProps={props} controls={controls} />);
}

export function TimerIcon({ width = 24, height = 24 }: { width?: number; height?: number; }) {
    return <svg width={width} height={height} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="13" r="8" /><path d="M9 2h6M12 5V2M12 9v4l3 2" />
    </svg>;
}

export function renderFocusButton(open: () => void) {
    return <HeaderBarButton icon={TimerIcon} tooltip="Focus timer" onClick={open} />;
}
