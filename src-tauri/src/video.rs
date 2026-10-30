//! A local page for YouTube embeds.
//!
//! YouTube refuses to play embeds that arrive without a `Referer` (error 153), and the
//! app's pages are served from `tauri://localhost` on macOS and Linux, a scheme browsers
//! never send as a referrer. So the app runs a tiny HTTP listener on 127.0.0.1 that serves
//! exactly one thing: a page holding the YouTube player for a given video id. The player
//! is then embedded from an ordinary http origin and gets a normal referrer.
//!
//! The listener binds to the loopback interface only, on a port the system picks, and
//! answers nothing but `GET /youtube?v=<11-character id>`.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

/// Start the listener; returns its base URL, e.g. `http://127.0.0.1:49152`.
pub fn start() -> std::io::Result<String> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let base = format!("http://{}", listener.local_addr()?);
    let origin = base.clone();
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let origin = origin.clone();
            thread::spawn(move || {
                let _ = respond(stream, &origin);
            });
        }
    });
    Ok(base)
}

fn respond(mut stream: TcpStream, origin: &str) -> std::io::Result<()> {
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line)?;
    let target = line.split_whitespace().nth(1).unwrap_or("");

    let (status, body) = match video_id(target) {
        Some(id) => ("200 OK", page(id, origin)),
        None => ("404 Not Found", String::from("Not found")),
    };
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\
         Referrer-Policy: strict-origin-when-cross-origin\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())
}

/// The id from `/youtube?v=<id>`, if it is a well-formed YouTube id.
fn video_id(target: &str) -> Option<&str> {
    let query = target.strip_prefix("/youtube?")?;
    let id = query.split('&').find_map(|pair| pair.strip_prefix("v="))?;
    let valid = id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    valid.then_some(id)
}

fn page(id: &str, origin: &str) -> String {
    format!(
        r#"<!doctype html>
<meta charset="utf-8">
<meta name="referrer" content="strict-origin-when-cross-origin">
<title>Video</title>
<style>html,body{{margin:0;height:100%;background:#000}}iframe{{display:block;border:0;width:100%;height:100%}}</style>
<iframe src="https://www.youtube-nocookie.com/embed/{id}?autoplay=1&rel=0&cc_load_policy=1&origin={origin}"
  allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
  referrerpolicy="strict-origin-when-cross-origin"></iframe>"#
    )
}

#[cfg(test)]
mod tests {
    use super::video_id;

    #[test]
    fn accepts_only_well_formed_ids() {
        assert_eq!(video_id("/youtube?v=dQw4w9WgXcQ"), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("/youtube?x=1&v=dQw4w9WgXcQ"), Some("dQw4w9WgXcQ"));
        assert_eq!(video_id("/youtube?v=short"), None);
        assert_eq!(video_id("/youtube?v=<script>abc"), None);
        assert_eq!(video_id("/other?v=dQw4w9WgXcQ"), None);
    }
}
