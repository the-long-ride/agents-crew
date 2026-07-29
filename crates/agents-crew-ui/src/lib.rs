mod api;
mod model;
mod server;

pub use api::handle_request;
pub use model::{HttpRequest, HttpResponse, UiAddress, UiError, UiOptions};
pub use server::{bind, serve};

#[cfg(test)]
mod tests;
