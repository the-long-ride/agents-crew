use anyhow::Error;
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Serialize)]
struct Envelope<'a> {
    ok: bool,
    command: &'a str,
    data: Value,
    error: Option<Value>,
}

pub fn success<T: Serialize>(command: &str, data: T, json_mode: bool) {
    let value = serde_json::to_value(data).unwrap_or(Value::Null);
    if json_mode {
        let envelope = Envelope {
            ok: true,
            command,
            data: value,
            error: None,
        };
        println!("{}", serde_json::to_string_pretty(&envelope).unwrap());
    } else if let Some(text) = value.as_str() {
        println!("{text}");
    } else {
        println!("{}", serde_json::to_string_pretty(&value).unwrap());
    }
}

pub fn failure(command: &str, error: &Error, json_mode: bool) {
    if json_mode {
        let envelope = Envelope {
            ok: false,
            command,
            data: Value::Null,
            error: Some(json!({
                "code": "command_failed",
                "message": error.to_string(),
            })),
        };
        println!("{}", serde_json::to_string_pretty(&envelope).unwrap());
    } else {
        eprintln!("error: {error}");
    }
}
