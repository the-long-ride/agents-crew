use super::*;
use agents_crew_config::{CrewConfig, TemplateMetadata};
use serde_json::json;
use std::net::{IpAddr, Ipv4Addr};
use tempfile::tempdir;

#[test]
fn embedded_shell_contains_canvas_and_runtime_tabs() {
    let directory = tempdir().unwrap();
    let response = handle_request(
        directory.path(),
        HttpRequest {
            method: "GET".to_string(),
            path: "/".to_string(),
            body: Vec::new(),
        },
    )
    .unwrap();
    let body = String::from_utf8(response.body).unwrap();
    assert!(body.contains("Crew Canvas"));
    assert!(body.contains("Runtime"));
    assert!(!body.contains("https://"));
}

#[test]
fn template_put_rejects_mismatched_path_id() {
    let directory = tempdir().unwrap();
    let mut config = CrewConfig::starter();
    config.template = Some(TemplateMetadata {
        id: "actual".to_string(),
        name: "Actual".to_string(),
        description: String::new(),
        layout: std::collections::BTreeMap::new(),
    });
    let body = serde_json::to_vec(&json!({
        "scope": "workspace",
        "config": config
    }))
    .unwrap();
    let error = handle_request(
        directory.path(),
        HttpRequest {
            method: "PUT".to_string(),
            path: "/api/templates/other".to_string(),
            body,
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("path id"));
}

#[test]
fn run_route_rejects_path_traversal() {
    let directory = tempdir().unwrap();
    let error = handle_request(
        directory.path(),
        HttpRequest {
            method: "GET".to_string(),
            path: "/api/runs/../../config".to_string(),
            body: Vec::new(),
        },
    )
    .unwrap_err();
    assert!(error.to_string().contains("invalid run id"));
}

#[tokio::test]
async fn listener_is_loopback_only() {
    let (listener, address) = bind(0).await.unwrap();
    assert_eq!(address.socket.ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert!(address.socket.port() > 0);
    drop(listener);
}
