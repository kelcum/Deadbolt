/*
 * Deadbolt, a Discord client mod
 * Copyright (c) 2026 k3 and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/*
 * betterMicQuality
 *
 * Improves microphone audio quality by disabling software-based mic processing,
 * requesting stereo and high-resolution capture, and tuning Discord's Opus
 * encoding settings. Supports configurable bitrate, packet duration, DTX, CBR,
 * FEC, and sample rate, while patching WebRTC audio constraints, SDP negotiation,
 * and sender parameters to keep the selected settings applied during calls.
 * Includes optional protection against same-device audio track replacement.
 *
 * HONEST LIMITS, read before assuming this makes your audio "lossless":
 *   - Discord's WebRTC voice pipeline transmits Opus. Opus is a lossy codec,
 *     so no client-side setting can turn Discord voice into PCM/FLAC-lossless.
 *   - The bitrate setting is a client-side target. Discord's voice servers can
 *     negotiate or cap the bitrate they accept, so requesting 512kbps does not
 *     guarantee that 512kbps is actually transmitted.
 *   - Microphone processing performed by Windows or your hardware/driver before
 *     the browser receives the audio cannot be removed by this plugin.
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    rawVoice: {
        type: OptionType.BOOLEAN,
        description:
            "Strips all mic processing: echo cancel, noise suppression, AGC, highpass filter, typing noise detection, beamforming, and every Chromium goog* flag. Overrides the three individual toggles below.",
        default: true,
        restartNeeded: false,
    },
    disableEchoCancellation: {
        type: OptionType.BOOLEAN,
        description: "Disable echo cancellation. Ignored when Raw Voice is on.",
        default: true,
        restartNeeded: false,
    },
    disableNoiseSuppression: {
        type: OptionType.BOOLEAN,
        description: "Disable noise suppression. Ignored when Raw Voice is on.",
        default: true,
        restartNeeded: false,
    },
    disableAutoGainControl: {
        type: OptionType.BOOLEAN,
        description: "Disable automatic gain control. Ignored when Raw Voice is on.",
        default: true,
        restartNeeded: false,
    },
    stereo: {
        type: OptionType.BOOLEAN,
        description:
            "Capture and encode in stereo. Most USB condensers (Yeti Classic, Yeti X, QuadCast) support true stereo capture.",
        default: true,
        restartNeeded: false,
    },
    sampleRate: {
        type: OptionType.SELECT,
        description: "Sample rate to request from your mic driver.",
        options: [
            { label: "48 kHz — recommended (Opus native rate, zero resampling)", value: 48000, default: true },
            { label: "44.1 kHz", value: 44100 },
            { label: "96 kHz — only if your interface truly supports it natively", value: 96000 },
        ],
    },
    highResCapture: {
        type: OptionType.BOOLEAN,
        description:
            "Request 24-bit capture depth instead of 16-bit. Ignored if your driver doesn't support it, so leaving this on is always safe.",
        default: true,
        restartNeeded: false,
    },
    bitrate: {
        type: OptionType.SLIDER,
        description:
            "Target Opus encoder bitrate in kbps. Discord's UI caps out far below this. 320–512 gives noticeably cleaner highs, lows, and stereo imaging.",
        markers: [8, 16, 32, 64, 96, 128, 192, 256, 320, 384, 450, 512],
        default: 512,
        stickToMarkers: false,
    },
    disableDtx: {
        type: OptionType.BOOLEAN,
        description:
            "Disable Opus DTX (discontinuous transmission). DTX silence-gates your stream during pauses — bad for musicians or anyone who needs a continuous signal.",
        default: true,
        restartNeeded: false,
    },
    forceCbr: {
        type: OptionType.BOOLEAN,
        description:
            "Force constant bitrate instead of variable. VBR sounds better per kbps — only turn this on if you specifically need a predictable, fixed bitrate.",
        default: false,
        restartNeeded: false,
    },
    enableFec: {
        type: OptionType.BOOLEAN,
        description:
            "Enable Opus in-band FEC. Reconstructs lost packets from adjacent frames. Recommended on unless your connection is rock solid and you need every bit for audio.",
        default: true,
        restartNeeded: false,
    },
    packetTime: {
        type: OptionType.SELECT,
        description:
            "Opus packet duration in ms. Lower means less latency but more CPU and bandwidth overhead. 10 ms is the sweet spot for real-time voice; 20 ms is the Opus default.",
        options: [
            { label: "5 ms — ultra-low latency, highest overhead", value: 5 },
            { label: "10 ms — recommended", value: 10, default: true },
            { label: "20 ms — Opus default", value: 20 },
            { label: "40 ms", value: 40 },
            { label: "60 ms — most efficient, noticeable latency", value: 60 },
        ],
    },
    bitrateEnforceInterval: {
        type: OptionType.BOOLEAN,
        description:
            "Re-applies your target bitrate every 3 seconds. Stops Discord from resetting your encoding parameters mid-call.",
        default: true,
        restartNeeded: false,
    },
    blockSetParameters: {
        type: OptionType.BOOLEAN,
        description:
            "Intercepts RTCRtpSender.setParameters() so Discord can't use the encoding API to quietly lower your bitrate.",
        default: true,
        restartNeeded: false,
    },
    blockTrackReplacement: {
        type: OptionType.BOOLEAN,
        description:
            "EXPERIMENTAL — blocks same-device replaceTrack() calls. Prevents Krisp from swapping your raw track for a denoised one mid-call. Switching mics still works. Disable immediately if your mic stops transmitting.",
        default: false,
        restartNeeded: false,
    },
});

let originalGetUserMedia: typeof navigator.mediaDevices.getUserMedia;
let originalRTCPeerConnection: typeof RTCPeerConnection;
let originalApplyConstraints: typeof MediaStreamTrack.prototype.applyConstraints;
let originalReplaceTrack: typeof RTCRtpSender.prototype.replaceTrack;
let originalSetParameters: typeof RTCRtpSender.prototype.setParameters;
let enforceInterval: ReturnType<typeof setInterval> | null = null;

const trackedConnections = new Set<RTCPeerConnection>();
const senderRawDeviceId = new WeakMap<RTCRtpSender, string | undefined>();

function buildAudioConstraints(
    existing: MediaTrackConstraints
): MediaTrackConstraints & Record<string, unknown> {
    const a: MediaTrackConstraints & Record<string, unknown> = { ...existing };
    const raw = settings.store.rawVoice;

    a.echoCancellation = raw ? false : !settings.store.disableEchoCancellation;
    a.noiseSuppression = raw ? false : !settings.store.disableNoiseSuppression;
    a.autoGainControl = raw ? false : !settings.store.disableAutoGainControl;

    if (settings.store.stereo) a.channelCount = { ideal: 2 };
    a.sampleRate = { ideal: Number(settings.store.sampleRate) || 48000 };
    if (settings.store.highResCapture) a.sampleSize = { ideal: 24 };
    a.latency = { ideal: 0 };

    if (raw) {
        a.googEchoCancellation = false;
        a.googEchoCancellation2 = false;
        a.googAutoGainControl = false;
        a.googAutoGainControl2 = false;
        a.googNoiseSuppression = false;
        a.googNoiseSuppression2 = false;
        a.googHighpassFilter = false;
        a.googTypingNoiseDetection = false;
        a.googAudioMirroring = false;
        a.googBeamforming = false;
        a.googArrayGeometry = false;
        a.googExperimentalEchoCancellation = false;
        a.googExperimentalNoiseSuppression = false;
        a.googExperimentalAutoGainControl = false;
    }

    return a;
}

function patchAudioConstraints(constraints: MediaStreamConstraints): MediaStreamConstraints {
    if (!constraints?.audio) return constraints;
    const existing = typeof constraints.audio === "object" ? constraints.audio : {};
    return { ...constraints, audio: buildAudioConstraints(existing) };
}

function setOrReplaceFmtpParam(line: string, key: string, value: string): string {
    const re = new RegExp(`${key}=[^;\\s]*`);
    return re.test(line) ? line.replace(re, `${key}=${value}`) : `${line};${key}=${value}`;
}

function tuneOpusSdp(sdp: string): string {
    if (!sdp) return sdp;

    const bitrateBps = Math.round(Number(settings.store.bitrate) * 1000);
    const bitrateKbps = Math.round(Number(settings.store.bitrate));
    const ptime = Number(settings.store.packetTime) || 10;
    const stereoFlag = settings.store.stereo ? "1" : "0";
    const dtxFlag = settings.store.disableDtx ? "0" : "1";
    const cbrFlag = settings.store.forceCbr ? "1" : "0";
    const fecFlag = settings.store.enableFec ? "1" : "0";

    const lines = sdp.split("\r\n");
    const opusLine = lines.find(l => /^a=rtpmap:\d+ opus\/48000/i.test(l));
    if (!opusLine) return sdp;

    const pt = opusLine.match(/^a=rtpmap:(\d+)/)![1];

    let inAudio = false;
    let bInjected = false;
    let foundFmtp = false;
    const out: string[] = [];

    for (const line of lines) {
        if (line.startsWith("m=audio")) {
            inAudio = true;
            bInjected = false;
            out.push(line);
            continue;
        }
        if (line.startsWith("m=") && !line.startsWith("m=audio")) {
            inAudio = false;
        }

        if (inAudio && line.startsWith("b=")) continue;

        if (inAudio && !bInjected && line.startsWith("c=")) {
            out.push(line);
            out.push(`b=AS:${bitrateKbps}`);
            out.push(`b=TIAS:${bitrateBps}`);
            bInjected = true;
            continue;
        }

        if (line.startsWith(`a=fmtp:${pt} `)) {
            foundFmtp = true;
            let updated = line;
            updated = setOrReplaceFmtpParam(updated, "maxaveragebitrate", String(bitrateBps));
            updated = setOrReplaceFmtpParam(updated, "maxplaybackrate", "48000");
            updated = setOrReplaceFmtpParam(updated, "sprop-maxcapturerate", "48000");
            updated = setOrReplaceFmtpParam(updated, "stereo", stereoFlag);
            updated = setOrReplaceFmtpParam(updated, "sprop-stereo", stereoFlag);
            updated = setOrReplaceFmtpParam(updated, "usedtx", dtxFlag);
            updated = setOrReplaceFmtpParam(updated, "cbr", cbrFlag);
            updated = setOrReplaceFmtpParam(updated, "useinbandfec", fecFlag);
            updated = setOrReplaceFmtpParam(updated, "minptime", String(ptime));
            out.push(updated);
            out.push(`a=ptime:${ptime}`);
            out.push(`a=maxptime:${ptime}`);
            continue;
        }

        if (inAudio && (line.startsWith("a=ptime:") || line.startsWith("a=maxptime:"))) continue;

        out.push(line);
    }

    if (!foundFmtp) {
        const idx = out.findIndex(l => l.startsWith(`a=rtpmap:${pt} `));
        if (idx !== -1) {
            out.splice(
                idx + 1, 0,
                `a=fmtp:${pt} maxaveragebitrate=${bitrateBps};maxplaybackrate=48000;` +
                    `sprop-maxcapturerate=48000;stereo=${stereoFlag};sprop-stereo=${stereoFlag};` +
                    `usedtx=${dtxFlag};cbr=${cbrFlag};useinbandfec=${fecFlag};minptime=${ptime}`,
                `a=ptime:${ptime}`,
                `a=maxptime:${ptime}`
            );
        }
    }

    return out.join("\r\n");
}

async function applyBitrate(sender: RTCRtpSender): Promise<void> {
    if (!sender || sender.track?.kind !== "audio") return;
    try {
        const params = sender.getParameters();
        if (!params.encodings?.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = Math.round(Number(settings.store.bitrate) * 1000);
        await originalSetParameters.call(sender, params);
    } catch (e) {
        console.warn("[betterMicQuality] applyBitrate:", e);
    }
}

function enforceBitrateNow(): void {
    if (!settings.store.bitrateEnforceInterval) return;
    for (const pc of trackedConnections) {
        if (pc.connectionState === "connected") {
            pc.getSenders()
                .filter(s => s.track?.kind === "audio")
                .forEach(applyBitrate);
        }
    }
}

function buildPatchedRTCPeerConnection(): typeof RTCPeerConnection {
    // lib.dom still types createOffer/createAnswer with the legacy
    // callback overloads, which our promise-only overrides can't satisfy -
    // extend it untyped, the final cast below restores the public type.
    return class PatchedRTCPeerConnection extends (originalRTCPeerConnection as any) {
        constructor(config?: RTCConfiguration) {
            super(config);
            trackedConnections.add(this as unknown as RTCPeerConnection);
            this.addEventListener("connectionstatechange", () => {
                if (this.connectionState === "connected") {
                    this.getSenders()
                        .filter(s => s.track?.kind === "audio")
                        .forEach(applyBitrate);
                } else if (this.connectionState === "closed") {
                    trackedConnections.delete(this as unknown as RTCPeerConnection);
                }
            });
        }

        addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender {
            const sender = super.addTrack(track, ...streams);
            if (track.kind === "audio") {
                senderRawDeviceId.set(sender, track.getSettings().deviceId);
                applyBitrate(sender);
            }
            return sender;
        }

        addTransceiver(
            trackOrKind: MediaStreamTrack | string,
            init?: RTCRtpTransceiverInit
        ): RTCRtpTransceiver {
            const tc = super.addTransceiver(trackOrKind as any, init);
            const kind = typeof trackOrKind === "string" ? trackOrKind : trackOrKind.kind;
            if (kind === "audio") applyBitrate(tc.sender);
            return tc;
        }

        async createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> {
            const offer = await super.createOffer(options);
            return { ...offer, sdp: tuneOpusSdp(offer.sdp ?? "") };
        }

        async createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> {
            const answer = await super.createAnswer(options);
            return { ...answer, sdp: tuneOpusSdp(answer.sdp ?? "") };
        }

        async setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void> {
            if (description?.sdp) {
                description = { ...description, sdp: tuneOpusSdp(description.sdp) };
            }
            return super.setLocalDescription(description as RTCSessionDescriptionInit);
        }
    } as unknown as typeof RTCPeerConnection;
}

export default definePlugin({
    name: "BetterMicQuality",
    description:
        "Removes Discord's mic processing and bypasses the bitrate cap. Patches getUserMedia, applyConstraints, SDP negotiation, and setParameters so Discord can't undo your settings mid-call.",
    tags: ["Voice"],
    authors: [
        {
            name: "m0pu",
            id: 770744865675149323n,
        },
    ],
    settings,

    start() {
        originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) =>
            originalGetUserMedia(patchAudioConstraints(constraints ?? {}));

        originalRTCPeerConnection = window.RTCPeerConnection;
        window.RTCPeerConnection = buildPatchedRTCPeerConnection();

        originalApplyConstraints = MediaStreamTrack.prototype.applyConstraints;
        MediaStreamTrack.prototype.applyConstraints = function (
            this: MediaStreamTrack,
            constraints?: MediaTrackConstraints
        ) {
            const patched = this.kind === "audio"
                ? buildAudioConstraints(constraints ?? {})
                : constraints;
            return originalApplyConstraints.call(this, patched);
        };

        originalSetParameters = RTCRtpSender.prototype.setParameters;
        RTCRtpSender.prototype.setParameters = function (
            this: RTCRtpSender,
            params: RTCRtpSendParameters
        ): Promise<void> {
            if (settings.store.blockSetParameters && this.track?.kind === "audio") {
                const floor = Math.round(Number(settings.store.bitrate) * 1000);
                if (params.encodings?.length) {
                    params = {
                        ...params,
                        encodings: params.encodings.map(enc => ({
                            ...enc,
                            maxBitrate: Math.max(enc.maxBitrate ?? 0, floor),
                        })),
                    };
                }
            }
            return originalSetParameters.call(this, params);
        };

        originalReplaceTrack = RTCRtpSender.prototype.replaceTrack;
        RTCRtpSender.prototype.replaceTrack = function (
            this: RTCRtpSender,
            withTrack: MediaStreamTrack | null
        ): Promise<void> {
            if (
                settings.store.blockTrackReplacement &&
                this.track?.kind === "audio" &&
                withTrack?.kind === "audio"
            ) {
                const orig = senderRawDeviceId.get(this);
                const incoming = withTrack.getSettings().deviceId;
                if (orig && orig === incoming) {
                    console.info("[betterMicQuality] Blocked same-device track swap.");
                    return Promise.resolve();
                }
                senderRawDeviceId.set(this, incoming);
            }
            return originalReplaceTrack.call(this, withTrack);
        };

        enforceInterval = setInterval(enforceBitrateNow, 3000);
    },

    stop() {
        if (originalGetUserMedia)
            navigator.mediaDevices.getUserMedia = originalGetUserMedia;
        if (originalRTCPeerConnection)
            window.RTCPeerConnection = originalRTCPeerConnection;
        if (originalApplyConstraints)
            MediaStreamTrack.prototype.applyConstraints = originalApplyConstraints;
        if (originalSetParameters)
            RTCRtpSender.prototype.setParameters = originalSetParameters;
        if (originalReplaceTrack)
            RTCRtpSender.prototype.replaceTrack = originalReplaceTrack;
        if (enforceInterval)
            clearInterval(enforceInterval);

        enforceInterval = null;
        trackedConnections.clear();
    },
});
