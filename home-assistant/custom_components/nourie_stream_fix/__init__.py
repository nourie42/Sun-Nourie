"""Nest camera stream fixes and a separate camera troubleshooting log.

1. Short go2rtc stream names. go2rtc 1.9.14 fails to replace sources on stream
   names over 128 characters, which Nest identifiers can exceed.
2. Keep live Nest links. Nest renews its RTSP link about every five minutes and
   the new URL carries a new token. Before every WebRTC offer and every still,
   Home Assistant compares the URL with go2rtc's and re-registers the stream when
   they differ, which tears down the connection everyone is watching. While
   go2rtc's link to the same Nest stream is connected, it is kept as it is.
   When that link is down, Home Assistant's normal behaviour applies unchanged.
3. Camera log. Offers, stills, kept and replaced links, and events sent by the
   Wall card go to <config>/nourie_cameras_log.jsonl. Lines are queued in memory
   and written by a background job every 10 seconds, so nothing on the video
   path waits for the disk.
"""

from __future__ import annotations

from collections import deque
from datetime import timedelta
from hashlib import sha256
import json
import logging
import os
import threading
import time
from typing import Any

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


async def _live_producer(provider: Any, identifier: str) -> dict[str, Any] | None:
    """go2rtc's running producer for this stream, from the raw API (the client model drops runtime fields)."""
    resp = await provider._rest_client._client.request("GET", "/api/streams")  # noqa: SLF001
    data = await resp.json()
    stream = data.get(identifier) if isinstance(data, dict) else None
    for producer in (stream or {}).get("producers") or []:
        if producer.get("remote_addr") or producer.get("bytes_recv"):
            return producer
    return None


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
        if camera.platform.platform_name == "nest":
            try:
                source = await camera.stream_source()
                identifier = go2rtc.get_camera_identifier(camera)
                if source:
                    producer = await _live_producer(self, identifier)
                    if producer and producer.get("url") != source and _base(producer.get("url", "")) == _base(source):
                        clog.add("ha", "link_kept", camera=cam, bytes=producer.get("bytes_recv"))
                        return
                    if producer is None:
                        clog.add("ha", "link_registered", camera=cam, reason="no running link")
                    elif producer.get("url") != source:
                        clog.add("ha", "link_registered", camera=cam, reason="new Nest stream")
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
    names = {go2rtc.get_camera_identifier(state_obj): state_obj.entity_id for state_obj in _cameras(hass)}
    out = {}
    for name, stream in (data or {}).items():
        producers = [
            {
                "running": bool(p.get("remote_addr") or p.get("bytes_recv")),
                "kind": (p.get("url") or "").split(":", 1)[0],
                "remote": (p.get("remote_addr") or "").rsplit(":", 1)[0],
                "bytes": p.get("bytes_recv"),
            }
            for p in (stream or {}).get("producers") or []
        ]
        consumers = [
            {"kind": c.get("format_name") or c.get("protocol") or "?", "bytes": c.get("bytes_send"), "remote": (c.get("remote_addr") or "").rsplit(":", 1)[0]}
            for c in (stream or {}).get("consumers") or []
        ]
        out[names.get(name, name[:24])] = {"producers": producers, "consumers": consumers}
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
