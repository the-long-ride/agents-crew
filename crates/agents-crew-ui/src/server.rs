use crate::{handle_request, HttpRequest, HttpResponse, UiAddress, UiError, UiOptions};
use serde_json::json;
use std::{
    io,
    net::Ipv4Addr,
    path::{Path, PathBuf},
    process::Command,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;

pub async fn bind(port: u16) -> Result<(TcpListener, UiAddress), UiError> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port)).await?;
    let socket = listener.local_addr()?;
    Ok((
        listener,
        UiAddress {
            socket,
            url: format!("http://127.0.0.1:{}", socket.port()),
        },
    ))
}

pub async fn serve(workspace: PathBuf, options: UiOptions) -> Result<(), UiError> {
    let (listener, address) = bind(options.port).await?;
    println!("Agents Crew UI: {}", address.url);
    if options.open_browser {
        let _ = open_browser(&address.url);
    }
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                let workspace = workspace.clone();
                tokio::spawn(async move {
                    let _ = serve_connection(stream, &workspace).await;
                });
            }
            signal = tokio::signal::ctrl_c() => {
                signal?;
                break;
            }
        }
    }
    Ok(())
}

async fn serve_connection(mut stream: TcpStream, workspace: &Path) -> Result<(), UiError> {
    let request = read_request(&mut stream).await?;
    let response = match handle_request(workspace, request) {
        Ok(response) => response,
        Err(error) => HttpResponse::json(400, json!({ "error": error.to_string() }))?,
    };
    write_response(&mut stream, response).await
}

async fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, UiError> {
    let mut data = Vec::new();
    let mut buffer = [0_u8; 8192];
    let header_end;
    loop {
        let count = stream.read(&mut buffer).await?;
        if count == 0 {
            return Err(UiError::BadRequest("connection closed".to_string()));
        }
        data.extend_from_slice(&buffer[..count]);
        if data.len() > MAX_REQUEST_BYTES {
            return Err(UiError::BadRequest("request too large".to_string()));
        }
        if let Some(position) = find_bytes(&data, b"\r\n\r\n") {
            header_end = position + 4;
            break;
        }
    }
    let header = std::str::from_utf8(&data[..header_end])
        .map_err(|_| UiError::BadRequest("invalid request encoding".to_string()))?;
    let mut lines = header.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| UiError::BadRequest("missing request line".to_string()))?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| UiError::BadRequest("missing method".to_string()))?
        .to_string();
    let path = parts
        .next()
        .ok_or_else(|| UiError::BadRequest("missing path".to_string()))?
        .to_string();
    let content_length = lines
        .filter_map(|line| line.split_once(':'))
        .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
        .map(|(_, value)| value.trim().parse::<usize>())
        .transpose()
        .map_err(|_| UiError::BadRequest("invalid content length".to_string()))?
        .unwrap_or(0);
    if header_end + content_length > MAX_REQUEST_BYTES {
        return Err(UiError::BadRequest("request too large".to_string()));
    }
    while data.len() < header_end + content_length {
        let count = stream.read(&mut buffer).await?;
        if count == 0 {
            return Err(UiError::BadRequest("incomplete request body".to_string()));
        }
        data.extend_from_slice(&buffer[..count]);
    }
    Ok(HttpRequest {
        method,
        path,
        body: data[header_end..header_end + content_length].to_vec(),
    })
}

async fn write_response(stream: &mut TcpStream, response: HttpResponse) -> Result<(), UiError> {
    let reason = match response.status {
        200 => "OK",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Error",
    };
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n",
        response.status,
        reason,
        response.content_type,
        response.body.len()
    );
    for (name, value) in response.headers {
        headers.push_str(&format!("{name}: {value}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).await?;
    stream.write_all(&response.body).await?;
    stream.shutdown().await?;
    Ok(())
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn open_browser(url: &str) -> io::Result<()> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", url]);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    command.spawn().map(|_| ())
}
