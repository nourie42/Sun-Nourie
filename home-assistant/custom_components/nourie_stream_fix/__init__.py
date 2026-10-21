"""Avoid go2rtc 1.9.14 YAML update failures for stream names over 128 characters."""

from hashlib import sha256

from homeassistant.components import go2rtc
from homeassistant.components.go2rtc import util as go2rtc_util


async def async_setup(hass, config) -> bool:
    """Keep short names; hash long provider names without changing HA entities."""
    original = go2rtc_util.get_camera_identifier
    if getattr(original, "_nourie_stream_fix", False):
        go2rtc.get_camera_identifier = original
        return True

    def compatible_identifier(camera):
        identifier = original(camera)
        if len(identifier) <= 128:
            return identifier
        return "nc_" + sha256(identifier.encode("utf-8")).hexdigest()

    compatible_identifier._nourie_stream_fix = True
    go2rtc_util.get_camera_identifier = compatible_identifier
    go2rtc.get_camera_identifier = compatible_identifier
    return True
