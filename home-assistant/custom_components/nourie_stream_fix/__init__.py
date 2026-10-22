"""Nest camera stream fixes and a separate camera troubleshooting log.

1. Short go2rtc stream names. go2rtc 1.9.14 fails to replace sources on stream
   names over 128 characters, which Nest identifiers can exceed.
2. Keep live Nest links. Nest renews its RTSP link about every five minutes and
   the new URL carries a new token. Before every WebRTC offer and every still,
   Home Assistant compares the URL with go2rtc's and re-registers the stream when
   they differ, which can create another upstream reader while existing viewers
   retain the old stream. Keep the same Nest link while video packets arrive.
   Serialize source decisions and observe one stable video receiver before
   treating its lack of progress as a stalled link.
3. Camera log. Offers, stills, kept and replaced links, and events sent by the
   Wall card go to <config>/nourie_cameras_log.jsonl. Lines are queued in memory
   and written by a background job every 10 seconds, so nothing on the video
   path waits for the disk.
"""

from __future__ import annotations

from collections import deque
from datetime import timedelta
from hashlib import sha256
import asyncio
import json
import logging
import os
import threading
import time
from typing import Any, NamedTuple

import voluptuous as vol

from homeassistant.components import go2rtc, websocket_api
from homeassistant.components.go2rtc import util as go2rtc_util
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.event import async_track_time_interval

_LOGGER = logging.getLogger(__name__)

DOMAIN = "nourie_stream_fix"
LOG_FILE = "nourie_cameras_log.jsonl"
LOG_MAX_BYTES = 2_000_000
FLUSH_EVERY = timedelta(seconds=10)
QUEUE_MAX = 5000
CLIENT_BATCH_MAX = 100


class CameraLog:
    """Queue in memory, write from the executor, keep one rotated file."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.path = hass.config.path(LOG_FILE)
        self.queue: deque[str] = deque(maxlen=QUEUE_MAX)
        self.lock = threading.Lock()

    @callback
    def add(self, source: str, event: str, **fields: Any) -> None:
        record = {"t": round(time.time(), 3), "src": source, "event": event}
        record.update({k: v for k, v in fields.items() if v is not None})
        try:
            self.queue.append(json.dumps(record, separators=(",", ":"), default=str)[:4000])
        except (TypeError, ValueError):
            return

    async def async_flush(self, _now: Any = None) -> None:
        if not self.queue:
            return
        lines = list(self.queue)
        self.queue.clear()
        await self.hass.async_add_executor_job(self._write, lines)

    def _write(self, lines: list[str]) -> None:
        with self.lock:
            try:
                if os.path.exists(self.path) and os.path.getsize(self.path) > LOG_MAX_BYTES:
                    os.replace(self.path, self.path + ".1")
                with open(self.path, "a", encoding="utf-8") as fh:
                    fh.write("\n".join(lines) + "\n")
            except OSError as err:
                _LOGGER.debug("Camera log write failed: %s", err)


def _camera_id(camera: Any) -> str:
    return getattr(camera, "entity_id", None) or "?"


def _base(url: str) -> str:
    return (url or "").split("?", 1)[0]


FLOWING_WINDOW = 1.5  # seconds between two looks when there is no recent one
RECENT = 10.0  # a look this recent can serve as the first of the two


class VideoSample(NamedTuple):
    """An immutable observation of identified video receivers on one producer."""

    at: float
    producer_id: int
    receivers: tuple[tuple[int, int], ...]


def _counter(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and 0 <= value < 2**63 else None


def _video_receivers(producer: dict[str, Any]) -> list[dict[str, int]] | None:
    """Return bounded video packet counters; absent or malformed tracks are unknown."""
    receivers = producer.get("receivers")
    if not isinstance(receivers, list) or len(receivers) > 32:
        return None
    video = []
    for receiver in receivers:
        if not isinstance(receiver, dict) or not isinstance(codec := receiver.get("codec"), dict):
            return None
        if codec.get("codec_type") != "video":
            continue
        ident = _counter(receiver.get("id"))
        # go2rtc omits zero counters from otherwise identified receiver objects.
        count = _counter(receiver.get("bytes", 0))
        packets = _counter(receiver.get("packets", 0))
        if ident is None or count is None or packets is None:
            return None
        video.append({"id": ident, "bytes": count, "packets": packets})
    if not video or len({item["id"] for item in video}) != len(video):
        return None
    return sorted(video, key=lambda item: item["id"])


def _video_sample(producer: dict[str, Any]) -> VideoSample | None:
    ident = _counter(producer.get("id"))
    receivers = _video_receivers(producer)
    if ident is None or receivers is None:
        return None
    return VideoSample(time.monotonic(), ident, tuple((item["id"], item["bytes"]) for item in receivers))


def _comparable(before: VideoSample, after: VideoSample) -> bool:
    return (
        before.producer_id == after.producer_id
        and tuple(item[0] for item in before.receivers) == tuple(item[0] for item in after.receivers)
        and all(new[1] >= old[1] for old, new in zip(before.receivers, after.receivers, strict=True))
    )


def _source_lock(provider: Any, identifier: str) -> asyncio.Lock:
    locks = getattr(provider, "_nourie_source_locks", None)
    if locks is None:
        provider._nourie_source_locks = locks = {}
    return locks.setdefault(identifier, asyncio.Lock())


async def _producer(provider: Any, identifier: str) -> dict[str, Any] | None:
    """go2rtc's connected producer for this stream, from the raw API (the client model drops runtime fields)."""
    resp = await provider._rest_client._client.request("GET", "/api/streams")  # noqa: SLF001
    data = await resp.json()
    stream = data.get(identifier) if isinstance(data, dict) else None
    for producer in (stream or {}).get("producers") or []:
        if producer.get("remote_addr") or producer.get("bytes_recv"):
            return producer
    return None


async def _live_producer(provider: Any, identifier: str) -> dict[str, Any] | None:
    """Observe video packet progress while the caller holds the source lock.

    An unchanged counter is a stall only after a full observation window on the
    same producer and receiver IDs. Changed or unobservable tracks are unknown.
    These counters establish packet arrival, not decoded frames or scene age.
    """
    seen = getattr(provider, "_nourie_video_seen", None)
    if seen is None:
        provider._nourie_video_seen = seen = {}
    producer = await _producer(provider, identifier)
    if producer is None:
        seen.pop(identifier, None)
        return None
    current = _video_sample(producer)
    previous = seen.get(identifier)
    if current is None:
        seen.pop(identifier, None)
        return {**producer, "_activity_unknown": True}
    seen[identifier] = current
    baseline = current
    if previous is not None and 0 <= current.at - previous.at <= RECENT:
        if not _comparable(previous, current):
            return {**producer, "_activity_unknown": True}
        if current.receivers != previous.receivers:
            return producer
        baseline = previous
    remaining = FLOWING_WINDOW - (current.at - baseline.at)
    if remaining > 0:
        await asyncio.sleep(remaining)
        producer = await _producer(provider, identifier)
        if producer is None:
            seen.pop(identifier, None)
            return None
        current = _video_sample(producer)
        if current is None:
            seen.pop(identifier, None)
            return {**producer, "_activity_unknown": True}
        seen[identifier] = current
        if not _comparable(baseline, current):
            return {**producer, "_activity_unknown": True}
    if current.receivers != baseline.receivers:
        return producer
    if current.at - baseline.at < FLOWING_WINDOW:
        return {**producer, "_activity_unknown": True}
    return {**producer, "_stalled": True}


def _patch_identifier() -> None:
    original = go2rtc_util.get_camera_identifier
    if getattr(original, "_nourie_stream_fix", False):
        go2rtc.get_camera_identifier = original
        return

    def compatible_identifier(camera):
        identifier = original(camera)
        if len(identifier) <= 128:
            return identifier
        return "nc_" + sha256(identifier.encode("utf-8")).hexdigest()

    compatible_identifier._nourie_stream_fix = True
    go2rtc_util.get_camera_identifier = compatible_identifier
    go2rtc.get_camera_identifier = compatible_identifier


def _patch_provider(log: CameraLog) -> None:
    provider_cls = go2rtc.WebRTCProvider
    if getattr(provider_cls._update_stream_source, "_nourie_stream_fix", False):  # noqa: SLF001
        provider_cls._nourie_log = log  # noqa: SLF001
        return
    provider_cls._nourie_log = log  # noqa: SLF001
    original_update = provider_cls._update_stream_source  # noqa: SLF001
    original_offer = provider_cls.async_handle_async_webrtc_offer
    original_image = provider_cls.async_get_image

    async def update_stream_source(self, camera):
        cam = _camera_id(camera)
        clog: CameraLog = provider_cls._nourie_log  # noqa: SLF001
        if camera.platform.platform_name != "nest":
            await original_update(self, camera)
            return
        identifier = go2rtc.get_camera_identifier(camera)
        # Include the normal HA update in the same critical section: otherwise
        # another offer can replace the named stream after our observation.
        async with _source_lock(self, identifier):
            try:
                source = await camera.stream_source()
                if source:
                    producer = await _live_producer(self, identifier)
                    # Sampling can wait. Never register a URL captured before that wait.
                    source = await camera.stream_source()
                    if source and producer and producer.get("_activity_unknown") and (
                        not producer.get("url") or _base(producer["url"]) == _base(source)
                    ):
                        clog.add("ha", "link_check_deferred", camera=cam, reason="video producer changed or is not observable")
                        return
                    stalled = bool(producer and producer.get("_stalled"))
                    if source and producer and not stalled and producer.get("url") != source and _base(producer.get("url", "")) == _base(source):
                        clog.add("ha", "link_kept", camera=cam, bytes=producer.get("bytes_recv"))
                        return
                    if source and stalled:
                        clog.add("ha", "link_registered", camera=cam, reason="link stalled, no video packet progress", decision_only=True)
                        if producer.get("url") == source:
                            # Same URL means Home Assistant would leave it alone; drop it so go2rtc dials again.
                            await self._rest_client.streams.add(identifier, [source, f"ffmpeg:{identifier}#audio=opus#query=log_level=debug"])
                            self._nourie_video_seen.pop(identifier, None)
                            return
                    elif producer is None:
                        clog.add("ha", "link_registered", camera=cam, reason="no running link", decision_only=True)
                    elif producer.get("url") != source:
                        clog.add("ha", "link_registered", camera=cam, reason="new Nest stream", decision_only=True)
            except Exception as err:  # noqa: BLE001 - never block the normal path
                clog.add("ha", "link_check_failed", camera=cam, error=type(err).__name__)
            await original_update(self, camera)

    async def handle_offer(self, camera, offer_sdp, session_id, send_message):
        provider_cls._nourie_log.add("ha", "offer", camera=_camera_id(camera))  # noqa: SLF001
        return await original_offer(self, camera, offer_sdp, session_id, send_message)

    async def get_image(self, camera, width=None, height=None):
        start = time.monotonic()
        try:
            image = await original_image(self, camera, width, height)
        except Exception as err:
            provider_cls._nourie_log.add("ha", "still_failed", camera=_camera_id(camera), ms=round(1000 * (time.monotonic() - start)), error=type(err).__name__)  # noqa: SLF001
            raise
        provider_cls._nourie_log.add("ha", "still", camera=_camera_id(camera), ms=round(1000 * (time.monotonic() - start)), bytes=len(image) if image else 0)  # noqa: SLF001
        return image

    for fn in (update_stream_source, handle_offer, get_image):
        fn._nourie_stream_fix = True
    provider_cls._update_stream_source = update_stream_source  # noqa: SLF001
    provider_cls.async_handle_async_webrtc_offer = handle_offer
    provider_cls.async_get_image = get_image


def _provider(hass: HomeAssistant) -> Any:
    for entry in hass.config_entries.async_entries("go2rtc"):
        if getattr(entry, "runtime_data", None) is not None:
            return entry.runtime_data
    return None


def _hls_status(camera: Any) -> dict[str, Any]:
    """Inspect existing stream objects only; never create or start a worker."""
    stream = getattr(camera, "stream", None)
    if stream is None:
        return {"present": False, "worker_alive": False, "outputs": []}
    thread = getattr(stream, "_thread", None)
    result = {
        "present": True,
        "worker_alive": bool(thread and thread.is_alive()),
        "keepalive": bool(getattr(getattr(stream, "dynamic_stream_settings", None), "preload_stream", False)),
        "outputs": [
            {"format": fmt if fmt in {"hls", "recorder"} else "other", "idle": bool(output.idle)}
            for fmt, output in list(stream.outputs().items())[:8]
        ],
    }
    diagnostics = stream.get_diagnostics()
    result["diagnostics"] = {
        key: value for key in ("start_worker", "worker_error", "update_source", "retry_timeout")
        if (value := _counter(diagnostics.get(key))) is not None
    }
    return result


@websocket_api.websocket_command(
    {
        vol.Required("type"): "nourie_stream_fix/log",
        vol.Required("events"): [dict],
        vol.Optional("client"): str,
    }
)
@callback
def ws_log(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """Accept a batch of events from a camera card; returns at once."""
    log: CameraLog = hass.data[DOMAIN]
    client = (msg.get("client") or "")[:80]
    for event in msg["events"][:CLIENT_BATCH_MAX]:
        name = str(event.get("event") or "event")[:40]
        fields = {str(k)[:40]: v for k, v in event.items() if k != "event"}
        log.add("card", name, client=client, **fields)
    connection.send_result(msg["id"], {"queued": min(len(msg["events"]), CLIENT_BATCH_MAX)})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "nourie_stream_fix/status"})
@websocket_api.async_response
async def ws_status(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg: dict[str, Any]) -> None:
    """What go2rtc is doing right now, without URLs or tokens."""
    provider = _provider(hass)
    if provider is None:
        connection.send_error(msg["id"], "no_go2rtc", "go2rtc is not loaded")
        return
    resp = await provider._rest_client._client.request("GET", "/api/streams")  # noqa: SLF001
    data = await resp.json()
    cameras = _cameras(hass)
    names = {go2rtc.get_camera_identifier(state_obj): state_obj.entity_id for state_obj in cameras}
    out = {}
    for name, stream in (data or {}).items():
        producers = [
            {
                "running": bool(p.get("remote_addr") or p.get("bytes_recv")),
                "kind": (p.get("url") or "").split(":", 1)[0],
                "remote": (p.get("remote_addr") or "").rsplit(":", 1)[0],
                "bytes": p.get("bytes_recv"),
                "id": _counter(p.get("id")),
                "video_receivers": _video_receivers(p),
            }
            for p in (stream or {}).get("producers") or []
        ]
        consumers = [
            {"kind": c.get("format_name") or c.get("protocol") or "?", "bytes": c.get("bytes_send"), "remote": (c.get("remote_addr") or "").rsplit(":", 1)[0]}
            for c in (stream or {}).get("consumers") or []
        ]
        out[names.get(name, name[:24])] = {"producers": producers, "consumers": consumers}
    for camera in cameras:
        out.setdefault(_camera_id(camera), {"producers": [], "consumers": []})["hls"] = _hls_status(camera)
    connection.send_result(msg["id"], out)


def _cameras(hass: HomeAssistant) -> list[Any]:
    component = hass.data.get("camera")
    entities = getattr(component, "entities", None)
    return list(entities) if entities is not None else []


async def async_setup(hass: HomeAssistant, config) -> bool:
    """Set up the fixes and the camera log."""
    log = hass.data.get(DOMAIN)
    if log is None:
        log = hass.data[DOMAIN] = CameraLog(hass)
        async_track_time_interval(hass, log.async_flush, FLUSH_EVERY, cancel_on_shutdown=True)
        hass.bus.async_listen_once("homeassistant_stop", log.async_flush)
    _patch_identifier()
    _patch_provider(log)
    websocket_api.async_register_command(hass, ws_log)
    websocket_api.async_register_command(hass, ws_status)
    log.add("ha", "started")
    return True
