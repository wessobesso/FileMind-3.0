//! Outbound transmission of processed file representations (sender stub).

use std::path::PathBuf;

/// Remote receiver configuration — wire destination when ready.
#[derive(Debug, Clone, Default)]
pub struct RemoteServerConfig {
    // TODO: endpoint URL (HTTPS POST / WebSocket / SSH host)
    // TODO: auth token or SSH identity path
    // TODO: batch size and retry policy
    pub endpoint: Option<String>,
}

/// Stream or batch-send cached representations to the remote server.
/// Not used in testing mode (cache-only).
pub async fn transmit_payload(_cache_root: PathBuf, _config: RemoteServerConfig) -> Result<(), String> {
    // TODO: implement HTTPS POST, WebSocket, SCP, or SSH tunnel sender with reconnection.
    Ok(())
}
