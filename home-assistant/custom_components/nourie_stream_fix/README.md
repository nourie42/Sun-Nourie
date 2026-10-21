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
