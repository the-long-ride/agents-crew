mod app;
mod args;
mod output;

use clap::Parser;

pub async fn run_cli() -> i32 {
    let cli = args::Cli::parse();
    let json = cli.json;
    match app::run(cli).await {
        Ok(data) => {
            output::success("crew", data, json);
            0
        }
        Err(error) => {
            output::failure("crew", &error, json);
            1
        }
    }
}
