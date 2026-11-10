use crate::MAX_DOCUMENT_BYTES;
use futures_util::future::{AbortHandle, AbortRegistration, Abortable};
use reqwest::{header, redirect, Client, Url};
use std::{sync::Mutex, time::Duration};
use tauri::{ipc::Response, Manager, Resource, ResourceId, WebviewWindow};

const HEADER_LIMIT: usize = 1024;
const MAX_REDIRECTS: usize = 5;
const TOO_LARGE: &str = "Choose a PDF smaller than 256 MB.";
const NOT_PDF: &str = "This URL did not return a PDF.";
const CANCELLED: &str = "The PDF download was cancelled.";

struct Download {
    abort: AbortHandle,
    registration: Mutex<Option<AbortRegistration>>,
}

impl Resource for Download {
    fn close(self: std::sync::Arc<Self>) {
        self.abort.abort();
    }
}

fn allowed_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.has_host()
        && url.username().is_empty()
        && url.password().is_none()
}

fn allowed_redirect(url: &Url, previous: &[Url]) -> bool {
    previous.len() <= MAX_REDIRECTS
        && allowed_url(url)
        && !previous
            .last()
            .is_some_and(|source| source.scheme() == "https" && url.scheme() == "http")
}

fn has_pdf_header(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(HEADER_LIMIT)]
        .windows(5)
        .any(|header| header == b"%PDF-")
}

fn download_error(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "The PDF download timed out. Try again.".into()
    } else if error.is_redirect() {
        "The PDF link redirected too many times or to an unsupported address.".into()
    } else {
        "Could not download the PDF. Check the link and your connection.".into()
    }
}

#[tauri::command]
pub fn prepare_online_pdf(window: WebviewWindow) -> ResourceId {
    let (abort, registration) = AbortHandle::new_pair();
    window.resources_table().add(Download {
        abort,
        registration: Mutex::new(Some(registration)),
    })
}

#[tauri::command]
pub fn cancel_online_pdf(window: WebviewWindow, request: ResourceId) {
    if let Ok(download) = window.resources_table().take::<Download>(request) {
        download.close();
    }
}

#[tauri::command]
pub async fn read_online_pdf(
    window: WebviewWindow,
    request: ResourceId,
    url: String,
) -> Result<Response, String> {
    let download = window
        .resources_table()
        .get::<Download>(request)
        .map_err(|_| CANCELLED)?;
    let registration = download
        .registration
        .lock()
        .map_err(|_| CANCELLED)?
        .take()
        .ok_or(CANCELLED)?;
    let result = Abortable::new(download_pdf(&url), registration).await;
    let _ = window.resources_table().take::<Download>(request);
    result.map_err(|_| CANCELLED)?
}

async fn download_pdf(url: &str) -> Result<Response, String> {
    let url = Url::parse(url.trim()).map_err(|_| "Enter a valid HTTP or HTTPS PDF link.")?;
    if !allowed_url(&url) {
        return Err("Use an HTTP or HTTPS link without a username or password.".into());
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(45))
        .referer(false)
        .redirect(redirect::Policy::custom(|attempt| {
            if allowed_redirect(attempt.url(), attempt.previous()) {
                attempt.follow()
            } else {
                attempt.error("unsupported redirect")
            }
        }))
        .build()
        .map_err(download_error)?;
    let mut response = client
        .get(url)
        .header(
            header::ACCEPT,
            "application/pdf, application/octet-stream;q=0.9",
        )
        .send()
        .await
        .map_err(download_error)?;
    if !response.status().is_success() {
        return Err(format!(
            "The PDF server returned HTTP {}.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_DOCUMENT_BYTES)
    {
        return Err(TOO_LARGE.into());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(download_error)? {
        let next_len = bytes.len() + chunk.len();
        if next_len as u64 > MAX_DOCUMENT_BYTES {
            return Err(TOO_LARGE.into());
        }
        let check_header = bytes.len() < HEADER_LIMIT && next_len >= HEADER_LIMIT;
        bytes.extend_from_slice(&chunk);
        if check_header && !has_pdf_header(&bytes) {
            return Err(NOT_PDF.into());
        }
    }
    if !has_pdf_header(&bytes) {
        return Err(NOT_PDF.into());
    }
    Ok(Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_credentials_unsafe_redirects_and_non_pdf_responses() {
        let https = Url::parse("https://example.com/report").unwrap();
        let http = Url::parse("http://example.com/report").unwrap();
        assert!(allowed_redirect(&https, std::slice::from_ref(&http)));
        assert!(!allowed_redirect(&http, std::slice::from_ref(&https)));
        assert!(!allowed_redirect(
            &https,
            &vec![https.clone(); MAX_REDIRECTS + 1]
        ));
        assert!(!allowed_url(
            &Url::parse("https://user:secret@example.com/report").unwrap()
        ));
        assert!(!allowed_url(&Url::parse("file:///example.pdf").unwrap()));
        assert!(has_pdf_header(b"\n%PDF-1.7\n"));
        assert!(!has_pdf_header(b"<html>Not a PDF</html>"));
    }
}
