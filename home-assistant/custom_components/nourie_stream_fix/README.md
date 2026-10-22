# Nest stream-name compatibility

This small Home Assistant integration works around a go2rtc 1.9.14 YAML update bug. The first registration of a stream name longer than 128 characters succeeds, but replacing its source can fail with HTTP 400. Nest stream identifiers can exceed this limit, so source renewal and snapshots can fail after playback initially works.

The compatibility function keeps identifiers of 128 characters or fewer unchanged. Longer internal relay identifiers become `nc_` plus their SHA256 digest. Camera entity IDs and integration unique IDs are unchanged. All provider operations use the same stable name.

Enable after installing this directory under `custom_components`:

```yaml
nourie_stream_fix:
```

Check the Home Assistant configuration and restart Core. The integration depends on the built-in go2rtc integration and updates its identifier function; it does not replace the relay binary or fork the integration.

Validation used exact Home Assistant 2026.8.2 provider paths and an isolated official go2rtc 1.9.14 process: long-name replacement reproduces the failure; hashed names survive repeated renewals, including with legacy long names still in the generated configuration.

To disable, remove the YAML entry and restart Core. Reassess this workaround after upgrading to a version that fixes long stream names upstream; already-short official identifiers pass through unchanged.

## Keep live Nest links (2.0.0)

Nest renews each RTSP link about every five minutes, and the renewed URL carries a new token. Before every WebRTC offer and every still, Home Assistant compares that URL with go2rtc's and re-registers the stream when they differ, which tears down the connection everyone is watching. Measured on this system, stills every 10 s took the Driveway from 0 s to 15 s frozen per minute.

While go2rtc's link to the same Nest stream (same path, only the token differs) is connected, it is kept as it is. When that link is down, or Nest issued a different stream, Home Assistant's normal behaviour runs unchanged.

## Camera log

Offers, stills (with how long they took), kept and re-registered links, and events from the Wall and camera cards (status changes, frozen/choppy periods, restarts and a five-minute summary per camera) are written to `nourie_cameras_log.jsonl` in the config folder, one JSON object per line. Lines are queued in memory and written every 10 seconds by a background job; the file rotates to `.1` at 2 MB.

`nourie_stream_fix/status` (admin, websocket) returns what go2rtc is doing right now per camera: running producers, consumers and byte counts, without URLs or tokens.
