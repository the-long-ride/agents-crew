mod app;
mod args;
mod output;

use clap::Parser;

#[tokio::main]
async fn main() {
    let cli = args::Cli::parse();
    let json = cli.json;
    match app::run(cli).await {
        Ok(data) => output::success("crew", data, json),
        Err(error) => {
            output::failure("crew", &error, json);
            std::process::exit(1);
        }
    }
}
