# Viewport adoption

In-process client that emulates a UniFi Protect Viewport device: connects
mTLS-WebSocket to the NVR's device server (ds, :7442), adopts keyless with an
admin-minted token, stays Online. Pure units: protocol/identity/token/backoff.
Wire: connection (ws) + index (AdoptionClient). WS path, adopt sequence, and
Viewport model string were verified against a live console.
